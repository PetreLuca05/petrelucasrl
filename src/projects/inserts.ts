import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { BLEED } from '../three/viewport.ts'
import { applyToonToModel, type ToonEntry } from '../toon/toon.ts'
import { toonTexturesLoaded, unityToonMaterials } from '../toon/unity.ts'
import type { Insert } from './data.ts'

const FOV = 32
// The text fades out over this many CSS px at its top and bottom edges (the mask on
// .detail-list in index.css); the models fade over the same, so they melt away with the text.
const FADE_TOP = 22
const FADE_BOTTOM = 28

// Draws a model's picture, rendered offscreen, onto the page with the text's fade. The picture
// is premultiplied and linear; it is converted to the screen's colours here.
const COMPOSITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`
const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  // the text's top and bottom edges and fade lengths, in drawing-buffer pixels from the bottom
  uniform vec4 uFade;
  varying vec2 vUv;
  void main() {
    vec4 picture = texture2D(map, vUv);
    float y = gl_FragCoord.y;
    float fade = clamp((uFade.x - y) / uFade.z, 0.0, 1.0) * clamp((y - uFade.y) / uFade.w, 0.0, 1.0);
    gl_FragColor = vec4(picture.rgb / max(picture.a, 1e-4), picture.a);
    #include <colorspace_fragment>
    gl_FragColor *= vec4(vec3(gl_FragColor.a), 1.0) * fade;
  }
`
// models that sway turn back and forth this far either side of their starting turn (radians)...
const SWAY = 0.6
// ...once every this many seconds; a sine, so it eases to a stop at each end
const SWAY_PERIOD = 7
// a model with several animations keeps one for between this long, in seconds...
const HOLD_MIN = 2.5
const HOLD_MAX = 6
// ...then blends into the next over this long
const BLEND = 0.5
// The player's bounding radius in its own units, which are Unity metres. Every model is drawn
// the same size, so each counts its own radius as this many metres and gets outlines as heavy.
const PLAYER_RADIUS = 2.43
// the light every model is lit by: Unity's white sun at intensity 1, casting shadows
const LIGHT_POSITION = new THREE.Vector3(2, 4, 3)
const SHADOW_MAP = 1024

type Loaded = { scene: THREE.Group; clips: THREE.AnimationClip[] }

type Slot = {
  element: HTMLElement
  insert: Insert
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  root: THREE.Group
  mixer: THREE.AnimationMixer | null
  // the model's animations, the one playing now, and how long until it changes its mind
  actions: THREE.AnimationAction[]
  current: number
  hold: number
  // how far through its sway the model is, in seconds, starting at a random point
  sway: number
}

const hold = () => HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN)

/**
 * 3D models set into a project's write-up. The page leaves an empty box for each one and the
 * text flows around it; every frame the box is measured and the model is drawn into exactly
 * that patch of the canvas behind the page, so the whole site still has one renderer.
 */
export function createInserts(renderer: THREE.WebGLRenderer) {
  const loader = new GLTFLoader()
  const cache = new Map<string, Promise<Loaded>>()
  let slots: Slot[] = []
  let list: HTMLElement | null = null
  const size = new THREE.Vector2()
  // each model is drawn here first, then onto the page through the fade; half floats so the
  // dark shades do not band, and multisampled like the canvas
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
  const composite = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: { map: { value: target.texture }, uFade: { value: new THREE.Vector4() } },
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    }),
  )
  composite.frustumCulled = false
  const compositeScene = new THREE.Scene().add(composite)
  const compositeCamera = new THREE.OrthographicCamera()
  const clearColor = new THREE.Color()
  const box = new THREE.Box3()
  const sphere = new THREE.Sphere()

  // a model loaded once, toon shaded, centred on the origin and scaled to fit a unit sphere
  const load = (insert: Insert) => {
    const url = insert.model
    let loaded = cache.get(url)
    if (!loaded) {
      loaded = loader.loadAsync(url).then(async (gltf) => {
        box.setFromObject(gltf.scene).getBoundingSphere(sphere)
        const table: Record<string, ToonEntry> = {}
        for (const [name, unity] of Object.entries(insert.toon ?? {})) table[name] = unityToonMaterials[unity]
        applyToonToModel(gltf.scene, table, { metre: insert.toon ? 1 : sphere.radius / PLAYER_RADIUS, fallback: 'derive' })
        const holder = new THREE.Group()
        gltf.scene.position.sub(sphere.center)
        holder.add(gltf.scene)
        holder.scale.setScalar(1 / Math.max(sphere.radius, 1e-3))
        await toonTexturesLoaded()
        return { scene: holder, clips: gltf.animations }
      })
      cache.set(url, loaded)
    }
    return loaded
  }

  return {
    /** Fetch models ahead of time, so they are there when their write-up opens. */
    preload(inserts: Insert[]) {
      for (const insert of inserts) load(insert).catch(() => {})
    },
    /** The boxes of the write-up now on the page, in order, and the text column that clips them. */
    set(items: { element: HTMLElement; insert: Insert }[], clip: HTMLElement) {
      list = clip
      // each write-up's models have their own lights and shadow maps; let the old ones go
      for (const slot of slots) slot.scene.traverse((object) => (object as THREE.Light).isLight && (object as THREE.Light).dispose())
      slots = items.map(({ element, insert }) => {
        // the toon shader reads only the first directional light, so that is all there is
        const scene = new THREE.Scene()
        const light = new THREE.DirectionalLight(0xffffff, 1)
        light.position.copy(LIGHT_POSITION)
        light.castShadow = true
        light.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
        // the model fits a unit sphere, a little more while it pops in
        const shadow = light.shadow.camera
        shadow.left = shadow.bottom = -1.3
        shadow.right = shadow.top = 1.3
        shadow.near = LIGHT_POSITION.length() - 1.5
        shadow.far = LIGHT_POSITION.length() + 1.5
        light.shadow.bias = -0.0005
        light.shadow.normalBias = 0.02
        scene.add(light)
        const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20)
        // a little above the model, far enough back for the unit sphere to fit the box
        const distance = 1.08 / Math.sin(THREE.MathUtils.degToRad(FOV / 2))
        camera.position.set(0, distance * 0.3, distance)
        camera.lookAt(0, 0, 0)
        const root = new THREE.Group()
        root.rotation.y = insert.turn ?? 0
        scene.add(root)
        const slot: Slot = { element, insert, scene, camera, root, mixer: null, actions: [], current: 0, hold: 0, sway: Math.random() * SWAY_PERIOD }
        load(insert)
          .then((loaded) => {
            // the write-up may have changed while the model was loading
            if (!slots.includes(slot)) return
            const model = cloneSkeleton(loaded.scene)
            root.add(model)
            const names = [insert.animation ?? []].flat()
            if (names.length) {
              const clips = names.map((name) => THREE.AnimationClip.findByName(loaded.clips, name)).filter((c) => c != null)
              if (!clips.length && loaded.clips[0]) clips.push(loaded.clips[0])
              if (clips.length) {
                slot.mixer = new THREE.AnimationMixer(model)
                slot.actions = clips.map((clip) => slot.mixer!.clipAction(clip))
                slot.actions[0].play()
                slot.hold = hold()
              }
            }
          })
          .catch(() => {})
        return slot
      })
    },
    /**
     * Draw every model that is on screen, over the frame just rendered. `amount` scales them
     * all, 0 to 1, for popping in and out with the write-up.
     */
    render(dt: number, amount: number) {
      if (!list || !slots.length) return
      const clip = list.getBoundingClientRect()
      renderer.getSize(size)
      const ratio = renderer.getPixelRatio()
      // the canvas is bled above and below the screen; WebGL measures from the bottom
      const fromBottom = (y: number) => (size.y - (y + BLEED)) * ratio
      ;(composite.material.uniforms.uFade.value as THREE.Vector4).set(
        fromBottom(clip.top),
        fromBottom(clip.bottom),
        FADE_TOP * ratio,
        FADE_BOTTOM * ratio,
      )
      renderer.getClearColor(clearColor)
      const clearAlpha = renderer.getClearAlpha()
      let drawn = false
      for (const slot of slots) {
        const rect = slot.element.getBoundingClientRect()
        if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.width < 1 || rect.height < 1) continue
        const scale = amount * (slot.insert.size ?? 1)
        if (scale < 0.01) continue

        slot.mixer?.update(dt)
        if (slot.actions.length > 1) {
          slot.hold -= dt
          if (slot.hold <= 0) {
            // move on to any of the other animations, fading this one out as that one fades in
            const from = slot.actions[slot.current]
            slot.current = (slot.current + 1 + Math.floor(Math.random() * (slot.actions.length - 1))) % slot.actions.length
            const to = slot.actions[slot.current]
            to.reset().play()
            from.crossFadeTo(to, BLEND, false)
            slot.hold = BLEND + hold()
          }
        }
        if (slot.insert.spin) {
          slot.sway += dt
          slot.root.rotation.y = (slot.insert.turn ?? 0) + SWAY * Math.sin((slot.sway / SWAY_PERIOD) * Math.PI * 2)
        }
        slot.root.scale.setScalar(scale)
        slot.camera.aspect = rect.width / rect.height
        slot.camera.updateProjectionMatrix()

        // the model alone, on a clear background, at the box's size in device pixels
        target.setSize(Math.round(rect.width * ratio), Math.round(rect.height * ratio))
        renderer.setRenderTarget(target)
        renderer.setClearColor(0x000000, 0)
        renderer.clear()
        renderer.render(slot.scene, slot.camera)
        renderer.setRenderTarget(null)
        renderer.setClearColor(clearColor, clearAlpha)

        // then onto the page in the box, kept inside the text and faded at its edges
        const top = Math.max(rect.top, clip.top)
        const bottom = Math.min(rect.bottom, clip.bottom)
        renderer.setViewport(rect.left, size.y - (rect.bottom + BLEED), rect.width, rect.height)
        renderer.setScissor(rect.left, size.y - (bottom + BLEED), rect.width, bottom - top)
        renderer.setScissorTest(true)
        renderer.render(compositeScene, compositeCamera)
        drawn = true
      }
      if (drawn) {
        renderer.setScissorTest(false)
        renderer.setViewport(0, 0, size.x, size.y)
      }
    },
    dispose() {
      target.dispose()
      composite.geometry.dispose()
      composite.material.dispose()
      slots = []
      for (const loaded of cache.values()) {
        loaded
          .then(({ scene }) =>
            scene.traverse((object) => {
              if (object instanceof THREE.Mesh) {
                object.geometry.dispose()
                for (const material of [object.material].flat()) material.dispose()
              }
            }),
          )
          .catch(() => {})
      }
      cache.clear()
    },
  }
}
