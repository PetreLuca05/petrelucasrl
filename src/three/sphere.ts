import * as THREE from 'three'
import { displayColor } from './color.ts'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObj;

  void main() {
    vUv = uv;
    vObj = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uWhite;
  uniform float uGrid;
  uniform float uSections;
  uniform float uSectionAmount;
  uniform float uFocusU;
  uniform float uFocus;
  uniform vec3 uFacing;
  uniform vec2 uResolution;

  varying vec2 vUv;
  varying vec3 vObj;

  ${displayColor}

  const vec3 WHITE = vec3(0.965, 0.965, 0.955);
  const vec3 GRID = vec3(0.25, 0.27, 0.32);
  // the dark backdrop of the landing: a soft glow a little above the centre of the screen
  const vec3 GLOW = vec3(0.165, 0.184, 0.227);
  const vec3 DARK = vec3(0.043, 0.051, 0.071);
  const float PI = 3.14159265;

  vec3 backdrop() {
    vec2 p = gl_FragCoord.xy / uResolution;
    float aspect = uResolution.x / uResolution.y;
    vec2 centre = vec2(0.5, 0.6);
    float d = length((p - centre) * vec2(aspect, 1.0));
    float corner = length((vec2(1.0) - centre) * vec2(aspect, 1.0));
    return mix(GLOW, DARK, clamp(d / (corner * 0.7), 0.0, 1.0));
  }

  // anti-aliased line at every integer of c, fading out once cells get smaller than a few pixels
  float gridLine(float c, float width) {
    float d = fwidth(c);
    float f = abs(fract(c - 0.5) - 0.5);
    float line = 1.0 - smoothstep(d * width * 0.5, d * (width * 0.5 + 1.0), f);
    return line * (1.0 - smoothstep(0.15, 0.5, d));
  }

  void main() {
    // on the landing only the backdrop shows; skip the grid maths for every pixel
    if (uWhite <= 0.0) {
      gl_FragColor = vec4(displayColor(backdrop()), 1.0);
      return;
    }

    // meridians bunch up at the poles, so fade them there
    float pole = smoothstep(0.02, 0.2, sin(vUv.y * PI));
    float mainGrid = max(gridLine(vUv.x * 36.0, 1.2) * pole, gridLine(vUv.y * 18.0, 1.2));
    float subGrid = max(gridLine(vUv.x * 144.0, 1.0) * pole, gridLine(vUv.y * 72.0, 1.0));

    float angle = acos(clamp(dot(normalize(vObj), uFacing), -1.0, 1.0));
    float rings = pow(0.5 + 0.5 * sin(angle * 10.0 - uTime * 1.6), 6.0);
    float scan = smoothstep(0.08, 0.0, abs(fract(vUv.y - uTime * 0.07) - 0.5));

    float strength = mainGrid * (0.10 + 0.10 * rings + 0.12 * scan) + subGrid * 0.035;

    if (uSections > 0.0) {
      // sections are centred on u = 0.75 (straight ahead, -z)
      strength += gridLine((vUv.x - 0.75) * uSections + 0.5, 2.5) * pole * 0.22 * uSectionAmount;
      float du = fract(vUv.x - uFocusU + 0.5) - 0.5;
      strength += step(abs(du), 0.5 / uSections) * uFocus * 0.03;
    }

    vec3 col = mix(WHITE, GRID, clamp(strength, 0.0, 1.0));

    // pure white washes over the backdrop first, then the grid fades in out of the white
    col = mix(vec3(1.0), col, uGrid);
    col = mix(backdrop(), col, uWhite);

    gl_FragColor = vec4(displayColor(col), 1.0);
  }
`

/**
 * The white grid dome, seen from inside: a unit sphere, scale it to size. Drawn first so content
 * inside stays visible. It paints every pixel: the dark backdrop of the landing, which `uWhite`
 * washes out to flat white, and then the grid, which `uGrid` brings in. The canvas needs no
 * clearing and nothing behind it.
 */
export function createSphere() {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },
      uWhite: { value: 1 },
      uGrid: { value: 1 },
      uSections: { value: 0 },
      uSectionAmount: { value: 0 },
      uFocusU: { value: 0.75 },
      uFocus: { value: 0 },
      uFacing: { value: new THREE.Vector3(0, 0, 1) },
      uResolution: { value: new THREE.Vector2(1, 1) },
    },
  })
  // seen from inside only, so one side and a coarser mesh are plenty; the grid is drawn per pixel
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material)
  mesh.renderOrder = -1
  return mesh
}
