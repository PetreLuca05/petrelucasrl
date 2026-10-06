import * as THREE from 'three'
import type { ToonEntry } from './toon.ts'

// Unity stores colours in linear space
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
const BLACK = linear(0, 0, 0)

let matcap: THREE.Texture | null = null
const loading: Promise<unknown>[] = []
/** Style3's MatCap, loaded the first time it is asked for. */
const chrome = () => {
  if (!matcap) {
    let done: (value: unknown) => void = () => {}
    loading.push(new Promise((resolve) => (done = resolve)))
    // until it arrives the texture is black, and multiplying by it would paint the model black
    matcap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/Chrome_Bright_Blue_Tint.png`, done, undefined, done)
    matcap.colorSpace = THREE.SRGBColorSpace
  }
  return matcap
}

/** Settles once every texture handed out so far has loaded (or failed to). */
export const toonTexturesLoaded = () => Promise.all(loading)

const entry = (base: THREE.Color, shade: THREE.Color, width: number, extra: Partial<ToonEntry> = {}): ToonEntry => ({
  baseColor: base,
  shadeColor: shade,
  // `_CullMode: 0`, both sides; Eyes, Eyes 1 and Style3 have 2, back faces culled
  side: THREE.DoubleSide,
  ...extra,
  outline: { color: BLACK, width, ...extra.outline },
})

/**
 * The MathGame player's Unity Toon Shader materials (`Cell Shader Export/materials/*.mat`).
 * Style1, 2 and 4 switch MatCap on without a texture, which shows nothing, so they have none.
 */
export const unityToonMaterials = {
  get Skin() {
    return entry(linear(1, 0.853, 0.608), linear(0.726, 0.629, 0.463), 0.25)
  },
  get Hooduie() {
    return entry(linear(0.925, 0.569, 0.231), linear(0.755, 0.445, 0.153), 0.25)
  },
  get Jeans() {
    return entry(linear(0.322, 0.617, 0.887), linear(0.216, 0.398, 0.566), 0.25)
  },
  get Eyes() {
    return entry(linear(0.906, 0.906, 0.906), linear(1, 1, 1), 0.23, { side: THREE.FrontSide })
  },
  get 'Eyes 1'() {
    return entry(linear(0.943, 0.943, 0.943), linear(1, 1, 1), 0.23, {
      side: THREE.FrontSide,
      outline: { color: linear(0.585, 0.585, 0.585), width: 0.23 },
    })
  },
  get Style1() {
    return entry(linear(0.93, 0.637, 1), linear(0.565, 0.301, 0.575), 0.25)
  },
  get Style2() {
    return entry(linear(1, 0.488, 0.335), linear(0.717, 0.37, 0.267), 0.25)
  },
  get Style3() {
    // the only one with an unfiltered light colour and an outline the light does not tint
    return entry(linear(0, 0.84, 0.925), linear(0, 0.666, 0.934), 0.25, {
      side: THREE.FrontSide,
      filterLight: false,
      matcap: chrome(),
      matcapMode: 'multiply',
      outline: { color: BLACK, width: 0.25, lightColor: false },
    })
  },
  get Style4() {
    return entry(linear(0.664, 1, 0.278), linear(0.358, 0.547, 0.142), 0.25)
  },
} satisfies Record<string, ToonEntry>

export type UnityMaterialName = keyof typeof unityToonMaterials
