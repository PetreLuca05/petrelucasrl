import * as THREE from 'three'

/**
 * A port of the parts of Unity Toon Shader (URP, "Double Shade With Feather") that the
 * MathGame player's materials use: two flat tones split by a hard step on half-Lambert, the
 * received shadow pushing the surface into the shade tone, an optional MatCap, and an
 * inverted-hull outline. Built on MeshLambertMaterial so skinning, morphs, shadow maps and fog
 * all keep working; only the lighting is replaced.
 */

// Unity's player meshes sit under a transform scaled ×100 (the Blender FBX export), so one
// unit of the mesh's own space, which `_Outline_Width × 0.001` is measured in, is 100 metres
const UNITY_OBJECT_UNIT = 100
// the outline thins with distance between these, in metres (`_Nearest_Distance`, `_Farthest_Distance`)
const OUTLINE_NEAREST = 0.5
const OUTLINE_FARTHEST = 100

export type ToonParams = {
  baseColor: THREE.Color
  shadeColor: THREE.Color
  /** Where half-Lambert flips from shade to base (`_BaseColor_Step`). */
  step?: number
  /** How soft that flip is (`_BaseShade_Feather`). */
  feather?: number
  /** Clamp the light colour to 1 first (`_Is_Filter_LightColor`). */
  filterLight?: boolean
  /** A texture both tones are multiplied by, like `_MainTex` (not used by the Unity materials). */
  map?: THREE.Texture | null
  matcap?: THREE.Texture | null
  matcapMode?: 'add' | 'multiply'
  /** Cull mode: Unity's `_CullMode` 2 is back-face culling, 0 draws both sides. */
  side?: THREE.Side
}

export type OutlineParams = {
  color: THREE.Color
  /** `_Outline_Width`, in Unity's units. */
  width: number
  /** Tint the outline by the light (`_Is_LightColor_Outline`). */
  lightColor?: boolean
}

/** Uniforms live outside the program so values can be changed after compiling. */
type Uniforms = Record<string, THREE.IUniform>

// the first directional light and its received shadow, the way UTS reads `mainLight`
const MAIN_LIGHT = /* glsl */ `
  vec3 toonLightDirection = normalize( vec3( 0.0, 1.0, 1.0 ) );
  vec3 toonLightColor = vec3( 0.0 );
  float toonShadow = 1.0;
  #if NUM_DIR_LIGHTS > 0
    toonLightDirection = directionalLights[ 0 ].direction;
    toonLightColor = directionalLights[ 0 ].color;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      if ( receiveShadow ) {
        DirectionalLightShadow toonShadowInfo = directionalLightShadows[ 0 ];
        toonShadow = getShadow( directionalShadowMap[ 0 ], toonShadowInfo.shadowMapSize, toonShadowInfo.shadowIntensity, toonShadowInfo.shadowBias, toonShadowInfo.shadowRadius, vDirectionalShadowCoord[ 0 ] );
      }
    #endif
  #endif
`

const LAMBERT_OUTPUT = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;'

/** Swap Lambert's lighting for `output`, which sets `outgoingLight` from the main light. */
const relight = (fragment: string, declarations: string, output: string) =>
  fragment
    .replace('#include <common>', `#include <common>\n${declarations}`)
    .replace('#include <lights_fragment_begin>', MAIN_LIGHT)
    .replace('#include <lights_fragment_maps>', '')
    .replace('#include <lights_fragment_end>', '')
    .replace(LAMBERT_OUTPUT, output)

/** The body pass: two tones with a hard edge, lit by the scene's first directional light. */
export function createToonMaterial(params: ToonParams) {
  const material = new THREE.MeshLambertMaterial({ map: params.map ?? null, side: params.side ?? THREE.FrontSide })
  const uniforms: Uniforms = {
    uToonBase: { value: params.baseColor.clone() },
    uToonShade: { value: params.shadeColor.clone() },
    uToonStep: { value: params.step ?? 0.5 },
    uToonFeather: { value: Math.max(params.feather ?? 0.0001, 1e-5) },
    uToonFilterLight: { value: params.filterLight ?? true },
    uToonMatcap: { value: params.matcap ?? null },
  }
  if (params.matcap) material.defines = { TOON_MATCAP: '', ...(params.matcapMode === 'multiply' ? { TOON_MATCAP_MULTIPLY: '' } : {}) }
  material.userData.toon = uniforms

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = relight(
      shader.fragmentShader,
      /* glsl */ `
uniform vec3 uToonBase;
uniform vec3 uToonShade;
uniform float uToonStep;
uniform float uToonFeather;
uniform bool uToonFilterLight;
#ifdef TOON_MATCAP
uniform sampler2D uToonMatcap;
#endif`,
      /* glsl */ `
  vec3 lightColor = uToonFilterLight ? min( toonLightColor, vec3( 1.0 ) ) : toonLightColor;
  // diffuseColor carries the map, like _MainTex multiplying both tones
  vec3 baseTone = uToonBase * diffuseColor.rgb * lightColor;
  vec3 shadeTone = uToonShade * diffuseColor.rgb * lightColor;
  float halfLambert = 0.5 * dot( normal, toonLightDirection ) + 0.5;
  // TweakShadow: a fully shadowed pixel keeps half its half-Lambert
  float shadowAttenuation = saturate( toonShadow * 0.5 + 0.5 );
  // Set_FinalShadowMask: 1 in the shade, 0 in the light, a linear ramp only 'feather' wide
  float shadeMask = saturate( 1.0 + ( halfLambert * shadowAttenuation - ( uToonStep - uToonFeather ) ) * -1.0 / uToonFeather );
  vec3 outgoingLight = mix( baseTone, shadeTone, shadeMask );
  #ifdef TOON_MATCAP
    // UTS's skew-corrected view normal, so the MatCap does not slide off-centre near the edges
    vec3 matcapBase = normalize( vViewPosition ) * vec3( -1.0, -1.0, 1.0 ) + vec3( 0.0, 0.0, 1.0 );
    vec3 matcapDetail = normal * vec3( -1.0, -1.0, 1.0 );
    vec3 matcapNormal = matcapBase * dot( matcapBase, matcapDetail ) / matcapBase.z - matcapDetail;
    vec3 matcap = textureLod( uToonMatcap, matcapNormal.xy * 0.5 + 0.5, 0.0 ).rgb * lightColor;
    #ifdef TOON_MATCAP_MULTIPLY
      outgoingLight *= matcap;
    #else
      outgoingLight += matcap;
    #endif
  #endif`,
    )
  }
  return material
}

/**
 * The inverted hull: back faces, pushed out along the skinned normal, in a flat colour.
 * `metre` is how many of the mesh's own units make a Unity metre.
 */
export function createOutlineMaterial(params: OutlineParams, metre = 1) {
  const material = new THREE.MeshLambertMaterial({ side: THREE.BackSide })
  const uniforms: Uniforms = {
    uOutlineColor: { value: params.color.clone() },
    uOutlineWidth: { value: params.width },
    uOutlineLight: { value: params.lightColor ?? true },
    uOutlineMetre: { value: metre },
  }
  material.userData.outline = uniforms

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlineWidth;\nuniform float uOutlineMetre;')
      .replace(
        '#include <skinning_vertex>',
        /* glsl */ `#include <skinning_vertex>
  {
    // distance from the object's origin to the camera, in Unity metres
    float worldPerMetre = length( modelMatrix[ 0 ].xyz ) / uOutlineMetre;
    float metres = distance( modelMatrix[ 3 ].xyz, cameraPosition ) / worldPerMetre;
    // smoothstep( far, near, d ): GLSL leaves a reversed smoothstep undefined, so spelled out
    float t = saturate( ( metres - ${OUTLINE_FARTHEST.toFixed(1)} ) / ( ${OUTLINE_NEAREST.toFixed(1)} - ${OUTLINE_FARTHEST.toFixed(1)} ) );
    float fade = t * t * ( 3.0 - 2.0 * t );
    // objectNormal has been through morphnormal_vertex and skinnormal_vertex by now
    transformed += objectNormal * uOutlineWidth * 0.001 * ${UNITY_OBJECT_UNIT.toFixed(1)} * uOutlineMetre * fade;
  }`,
      )
    shader.fragmentShader = relight(
      shader.fragmentShader,
      'uniform vec3 uOutlineColor;\nuniform bool uOutlineLight;',
      /* glsl */ `
  // a bright light is brought back to intensity 1 rather than clipped, keeping its hue
  vec3 lightColor = toonLightColor;
  float intensity = dot( lightColor, vec3( 0.299, 0.587, 0.114 ) );
  if ( intensity >= 1.0 ) lightColor /= intensity;
  vec3 outgoingLight = uOutlineColor * ( uOutlineLight ? lightColor : vec3( 1.0 ) );`,
    )
  }
  return material
}

/** One entry of a material table: what a mesh's material of that name becomes. */
export type ToonEntry = ToonParams & { outline: OutlineParams }

export type ApplyOptions = {
  /** How many of the model root's units make a Unity metre (1 for a model in metres). */
  metre?: number
  /**
   * What to do with a material missing from the table. 'derive' builds one from the
   * material's own colour and map, quietly; without it a grey default is used and a warning logged.
   */
  fallback?: 'derive'
}

// the Unity shade tones average about two thirds of their base tones
const DERIVED_SHADE = 0.67
const BLACK = new THREE.Color(0, 0, 0)
const GREY = new THREE.Color(0.8, 0.8, 0.8)
const DEFAULT_ENTRY: ToonEntry = {
  baseColor: GREY,
  shadeColor: GREY.clone().multiplyScalar(DERIVED_SHADE),
  outline: { color: BLACK, width: 0.25 },
}

const derive = (source: THREE.Material): ToonEntry => {
  const { color, map } = source as THREE.MeshStandardMaterial
  const base = color ? color.clone() : new THREE.Color(1, 1, 1)
  return {
    baseColor: base,
    shadeColor: base.clone().multiplyScalar(DERIVED_SHADE),
    map: map ?? null,
    side: source.side,
    outline: { color: BLACK, width: 0.25 },
  }
}

const inverse = new THREE.Matrix4()
const relative = new THREE.Matrix4()
const scale = new THREE.Vector3()
/** How much bigger `object` is drawn than its units, measured in `root`'s units. */
const scaleWithin = (object: THREE.Object3D, root: THREE.Object3D) => {
  inverse.copy(root.matrixWorld).invert()
  relative.multiplyMatrices(inverse, object.matrixWorld)
  return scale.setFromMatrixScale(relative).x
}

/**
 * Give every mesh under `root` its toon material from `table` (by material name) and an
 * outline: a sibling drawing the same geometry with the outline material, bound to the same
 * skeleton for a skinned mesh so the two animate together.
 */
export function applyToonToModel(root: THREE.Object3D, table: Record<string, ToonEntry>, options: ApplyOptions = {}) {
  const metre = options.metre ?? 1
  root.updateWorldMatrix(true, true)
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && !object.userData.toonOutline) meshes.push(object as THREE.Mesh)
  })
  const bodies = new Map<THREE.Material, { body: THREE.Material; entry: ToonEntry }>()
  const entryFor = (source: THREE.Material) => {
    let made = bodies.get(source)
    if (!made) {
      let entry: ToonEntry | undefined = table[source.name]
      if (!entry) {
        if (options.fallback !== 'derive') console.warn(`toon: no entry for material "${source.name}", using a grey default`)
        entry = options.fallback === 'derive' ? derive(source) : DEFAULT_ENTRY
      }
      made = { body: createToonMaterial(entry), entry }
      bodies.set(source, made)
    }
    return made
  }

  for (const mesh of meshes) {
    const sources = [mesh.material].flat()
    const made = sources.map(entryFor)
    // the outline's width is in the mesh's own units, so each mesh gets its own scale
    const meshMetre = metre / scaleWithin(mesh, root)
    const outlines = made.map(({ entry }) => createOutlineMaterial(entry.outline, meshMetre))
    const multi = Array.isArray(mesh.material)
    mesh.material = multi ? made.map((m) => m.body) : made[0].body
    mesh.castShadow = true
    mesh.receiveShadow = true

    let outline: THREE.Mesh
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = mesh as THREE.SkinnedMesh
      const hull = new THREE.SkinnedMesh(skinned.geometry, multi ? outlines : outlines[0])
      hull.bindMode = skinned.bindMode
      hull.bind(skinned.skeleton, skinned.bindMatrix)
      outline = hull
    } else {
      outline = new THREE.Mesh(mesh.geometry, multi ? outlines : outlines[0])
    }
    outline.name = `${mesh.name} outline`
    outline.userData.toonOutline = true
    outline.position.copy(mesh.position)
    outline.quaternion.copy(mesh.quaternion)
    outline.scale.copy(mesh.scale)
    outline.frustumCulled = mesh.frustumCulled
    outline.morphTargetInfluences = mesh.morphTargetInfluences
    outline.morphTargetDictionary = mesh.morphTargetDictionary
    mesh.parent?.add(outline)
  }
  for (const source of bodies.keys()) source.dispose()
}
