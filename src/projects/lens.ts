import * as THREE from 'three'

// diameters in CSS pixels: the plain ring shown when nothing is aimed at, and the glass lens
// it grows into over a card; then how much the middle of the lens magnifies
const RING_DIAMETER = 14
const RING_STROKE = 1.5
const DIAMETER = 64
const MAGNIFY = 1.5
// the quad is larger than the lens so the drop shadow has room
const QUAD = 1.6
const TARGET_SIZE = 320

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uScene;
  uniform float uAmount;
  uniform float uGlass;
  uniform float uStroke;
  varying vec2 vUv;

  // uScene holds exactly the patch of the scene behind the lens; q is -1..1 across it
  vec3 scene(vec2 q) {
    return texture2D(uScene, q * 0.5 + 0.5).rgb;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * ${QUAD.toFixed(1)};
    float r = length(p);
    vec2 dir = p / max(r, 1e-4);
    float aa = fwidth(r);
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);

    // Refraction: the middle magnifies, and the thick rim bends the view sharply inward.
    float rim = smoothstep(0.7, 1.0, r);
    float bent = r * mix(1.0 / ${MAGNIFY.toFixed(2)}, 1.0, pow(r, 3.5)) - rim * rim * 0.24;

    // the rim splits colours slightly, like real glass
    float split = rim * 0.04;
    vec3 col = vec3(scene(dir * (bent + split)).r, scene(dir * bent).g, scene(dir * (bent - split)).b);

    // faint milky body, denser toward the rim
    col = mix(col, vec3(1.0), 0.05 + 0.12 * rim);

    // light catching the edge: strong from the top left, a weaker bounce at the bottom right
    float edge = smoothstep(0.84, 0.975, r);
    float facing = dot(dir, normalize(vec2(-0.6, 0.8)));
    col += edge * (pow(max(facing, 0.0), 3.0) * 0.85 + pow(max(-facing, 0.0), 4.0) * 0.4);
    // soft glare on the dome of the glass
    col += smoothstep(0.55, 0.0, length(p - vec2(-0.3, 0.4))) * 0.08;
    // a thin darker line where the glass meets the page
    col *= 1.0 - 0.14 * smoothstep(0.94, 1.0, r);

    // shadow cast on the page, a little below the lens
    float shadow = (1.0 - smoothstep(0.85, 1.5, length(p - vec2(0.0, -0.1)))) * 0.2 * (1.0 - inside);

    // the plain state: a thin black ring of the same outline, which the glass fades in over
    float ring = smoothstep(1.0 - uStroke - aa, 1.0 - uStroke, r) * inside * 0.9;

    // premultiplied alpha
    vec4 glass = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb * inside, inside + shadow);
    gl_FragColor = mix(vec4(vec3(0.0), ring), glass, uGlass) * uAmount;
  }
`

/**
 * The crosshair fixed at the centre of the screen: a plain ring that morphs into a liquid-glass
 * lens while it is aimed at a card. The patch of scene behind it is
 * rendered again at higher resolution, then drawn through a refracting, magnifying shader.
 */
export function createLens() {
  const target = new THREE.WebGLRenderTarget(TARGET_SIZE, TARGET_SIZE, { samples: 4 })
  const patchCamera = new THREE.PerspectiveCamera()
  const size = new THREE.Vector2()

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uScene: { value: target.texture },
      uAmount: { value: 0 },
      uGlass: { value: 0 },
      uStroke: { value: 0 },
    },
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  const overlay = new THREE.Scene()
  overlay.add(quad)
  // one unit per CSS pixel, origin at the centre of the canvas
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)

  return {
    /**
     * Draw the crosshair over a frame that has just been rendered. `amount` fades it in and
     * out; `glass` (0..1) morphs it from the plain ring into the glass lens.
     */
    render(
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.PerspectiveCamera,
      amount: number,
      glass: number,
    ) {
      if (amount <= 0.001) return
      renderer.getSize(size)
      const morph = glass * glass * (3 - 2 * glass)
      const diameter = RING_DIAMETER + (DIAMETER - RING_DIAMETER) * morph

      // the same view as the main camera, cropped to the square behind the lens
      // (skipped while it is still a plain ring, which shows nothing of the scene)
      if (morph > 0.001) {
        patchCamera.copy(camera)
        patchCamera.setViewOffset(
          size.x,
          size.y,
          (size.x - diameter) / 2,
          (size.y - diameter) / 2,
          diameter,
          diameter,
        )
        patchCamera.updateProjectionMatrix()
        renderer.setRenderTarget(target)
        // the renderer never clears on its own (the dome paints every pixel); depth it does need
        renderer.clearDepth()
        renderer.render(scene, patchCamera)
        renderer.setRenderTarget(null)
      }

      overlayCamera.left = -size.x / 2
      overlayCamera.right = size.x / 2
      overlayCamera.top = size.y / 2
      overlayCamera.bottom = -size.y / 2
      overlayCamera.updateProjectionMatrix()
      quad.scale.setScalar(diameter * QUAD * (0.6 + 0.4 * amount))
      material.uniforms.uAmount.value = amount
      // the size may bounce past full (see the spring in scene.ts); the look stops at glass
      material.uniforms.uGlass.value = Math.min(morph, 1)
      material.uniforms.uStroke.value = RING_STROKE / (diameter / 2)

      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.render(overlay, overlayCamera)
      renderer.autoClear = autoClear
    },
    dispose() {
      target.dispose()
      quad.geometry.dispose()
      material.dispose()
    },
  }
}
