import * as THREE from 'three'
import { displayColor } from '../three/color.ts'

const FONT = '"Space Grotesk", system-ui, sans-serif'
const LAYERS = 14
const DEPTH = 0.07

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += sin(p.x * 2.2 + uTime * 1.3) * 0.035 + cos(p.y * 3.0 + uTime) * 0.02;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const frontShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uInk;
  uniform float uOpacity;
  varying vec2 vUv;
  ${displayColor}

  void main() {
    if (texture2D(uMap, vUv).a < 0.5) discard;
    vec3 col = mix(vec3(1.0), vec3(0.07, 0.08, 0.10), uInk);
    vec3 sweepCol = mix(vec3(0.75, 0.90, 1.0), vec3(0.35, 0.45, 0.60), uInk);
    float pos = fract(uTime * 0.18) * 1.8 - 0.4;
    float sweep = smoothstep(0.10, 0.0, abs(vUv.x + (vUv.y - 0.5) * 0.25 - pos));
    gl_FragColor = vec4(displayColor(mix(col, sweepCol, sweep * 0.85)), uOpacity);
  }
`

const sideShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uInk;
  uniform float uOpacity;
  varying vec2 vUv;
  ${displayColor}

  void main() {
    if (texture2D(uMap, vUv).a < 0.5) discard;
    gl_FragColor = vec4(displayColor(mix(vec3(0.55, 0.58, 0.64), vec3(0.40, 0.42, 0.46), uInk)), uOpacity);
  }
`

function drawTitle(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  ctx.font = `700 300px ${FONT}`
  ctx.letterSpacing = '-6px'
  // the fallback font can be wider than Space Grotesk; never let it clip
  const fit = Math.min(1, (canvas.width - 80) / ctx.measureText('PETRE LUCA').width)
  ctx.save()
  ctx.translate(canvas.width / 2, 330)
  ctx.scale(fit, fit)
  ctx.fillText('PETRE LUCA', 0, 0)
  ctx.restore()

  ctx.font = `700 140px ${FONT}`
  ctx.letterSpacing = '60px'
  // letter-spacing also trails the last glyph; shift by half of it to stay centred
  ctx.fillText('SRL', canvas.width / 2 + 30, 530)
}

/** "PETRE LUCA / SRL" as a rippling, fake-extruded plane, 2 units wide. */
export function createTitle() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 600
  drawTitle(canvas)
  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 8

  let disposed = false
  document.fonts.load('700 300px "Space Grotesk"').then(() => {
    if (disposed) return
    drawTitle(canvas)
    texture.needsUpdate = true
  })

  const uniforms = { uMap: { value: texture }, uTime: { value: 0 }, uInk: { value: 0 }, uOpacity: { value: 0 } }
  const front = new THREE.ShaderMaterial({ vertexShader, fragmentShader: frontShader, uniforms, transparent: true })
  const side = new THREE.ShaderMaterial({ vertexShader, fragmentShader: sideShader, uniforms, transparent: true })
  const geometry = new THREE.PlaneGeometry(2, (2 * canvas.height) / canvas.width, 96, 30)

  const group = new THREE.Group()
  for (let i = 0; i < LAYERS; i++) {
    const layer = new THREE.Mesh(geometry, i === 0 ? front : side)
    layer.position.z = (-i * DEPTH) / (LAYERS - 1)
    group.add(layer)
  }

  return {
    group,
    uniforms,
    dispose() {
      disposed = true
      geometry.dispose()
      front.dispose()
      side.dispose()
      texture.dispose()
    },
  }
}
