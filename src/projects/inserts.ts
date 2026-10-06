import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { BLEED } from '../three/viewport.ts'
import type { Insert } from './data.ts'

const FOV = 32
// a model is fully faded this far from the top and bottom edges of the text (CSS px)
const EDGE = 56
// radians per second, for models that turn on the spot
const SPIN = 0.5

type Loaded = { scene: THREE.Group; clips: THREE.AnimationClip[] }

type Slot = {
  element: HTMLElement
  insert: Insert
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  root: THREE.Group
  mixer: THREE.AnimationMixer | null
}

/**
 * 3D models set into a project's write-up. The page leaves an empty box for each one and the
 * text flows around it; every frame the box is measured and the model is drawn into exactly
 * that patch of the canvas behind the page, so the whole site still has one renderer.
 */
export function createInserts(renderer: THREE.WebGLRenderer, environment: THREE.Texture) {
  const loader = new GLTFLoader()
  const cache = new Map<string, Promise<Loaded>>()
  let slots: Slot[] = []
  let list: HTMLElement | null = null
  const size = new THREE.Vector2()
  const box = new THREE.Box3()
  const sphere = new THREE.Sphere()

  // a model loaded once, centred on the origin and scaled to fit a unit sphere
  const load = (url: string) => {
    let loaded = cache.get(url)
    if (!loaded) {
      loaded = loader.loadAsync(url).then((gltf) => {
        box.setFromObject(gltf.scene).getBoundingSphere(sphere)
        const holder = new THREE.Group()
        gltf.scene.position.sub(sphere.center)
        holder.add(gltf.scene)
        holder.scale.setScalar(1 / Math.max(sphere.radius, 1e-3))
        return { scene: holder, clips: gltf.animations }
      })
      cache.set(url, loaded)
    }
    return loaded
  }

  return {
    /** Fetch models ahead of time, so they are there when their write-up opens. */
    preload(urls: string[]) {
      for (const url of urls) load(url).catch(() => {})
    },
    /** The boxes of the write-up now on the page, in order, and the text column that clips them. */
    set(items: { element: HTMLElement; insert: Insert }[], clip: HTMLElement) {
      list = clip
      slots = items.map(({ element, insert }) => {
        // soft studio light, kept gentle so pale colours stay colours rather than washing out
        const scene = new THREE.Scene()
        scene.environment = environment
        scene.environmentIntensity = 0.7
        const light = new THREE.DirectionalLight(0xffffff, 0.9)
        light.position.set(2, 4, 3)
        scene.add(light)
        const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20)
        // a little above the model, far enough back for the unit sphere to fit the box
        const distance = 1.08 / Math.sin(THREE.MathUtils.degToRad(FOV / 2))
        camera.position.set(0, distance * 0.3, distance)
        camera.lookAt(0, 0, 0)
        const root = new THREE.Group()
        root.rotation.y = insert.turn ?? 0
        scene.add(root)
        const slot: Slot = { element, insert, scene, camera, root, mixer: null }
        load(insert.model)
          .then((loaded) => {
            // the write-up may have changed while the model was loading
            if (!slots.includes(slot)) return
            const model = cloneSkeleton(loaded.scene)
            root.add(model)
            if (insert.animation) {
              const clip = THREE.AnimationClip.findByName(loaded.clips, insert.animation) ?? loaded.clips[0]
              if (clip) {
                slot.mixer = new THREE.AnimationMixer(model)
                slot.mixer.clipAction(clip).play()
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
      let drawn = false
      for (const slot of slots) {
        const rect = slot.element.getBoundingClientRect()
        if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.width < 1 || rect.height < 1) continue
        // fade out toward the top and bottom of the text, like the text itself does
        const middle = rect.top + rect.height / 2
        const edge = Math.min(middle - clip.top, clip.bottom - middle) / EDGE
        const scale = amount * THREE.MathUtils.smoothstep(edge, 0, 1)
        if (scale < 0.01) continue

        slot.mixer?.update(dt)
        if (slot.insert.spin) slot.root.rotation.y += dt * SPIN
        slot.root.scale.setScalar(scale)
        slot.camera.aspect = rect.width / rect.height
        slot.camera.updateProjectionMatrix()

        // the canvas is bled above and below the screen; WebGL measures from the bottom
        const top = Math.max(rect.top, clip.top)
        const bottom = Math.min(rect.bottom, clip.bottom)
        renderer.setViewport(rect.left, size.y - (rect.bottom + BLEED), rect.width, rect.height)
        renderer.setScissor(rect.left, size.y - (bottom + BLEED), rect.width, bottom - top)
        renderer.setScissorTest(true)
        renderer.clearDepth()
        renderer.render(slot.scene, slot.camera)
        drawn = true
      }
      if (drawn) {
        renderer.setScissorTest(false)
        renderer.setViewport(0, 0, size.x, size.y)
      }
    },
    dispose() {
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
