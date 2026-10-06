import * as THREE from 'three'

/**
 * The page extends this many CSS pixels past the top and bottom of the screen (see `body`
 * in index.css) so iOS Safari has scene to show behind its translucent bars.
 */
/** How far the canvas extends past the top and bottom of the screen, in CSS pixels. */
export const BLEED = 140

/** Keep the page sized to the visible viewport plus the bleed, and parked in the middle of it. */
export function installViewport() {
  history.scrollRestoration = 'manual'
  // iOS Safari floats its bottom bar over the page, so the screen goes on below the viewport.
  // No API reports by how much; the browser's total chrome minus the status bar is close.
  const ua = navigator.userAgent
  const ios = /iP(hone|ad|od)/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  const standalone = (navigator as { standalone?: boolean }).standalone === true
  const sync = () => {
    const root = document.documentElement.style
    const underBar = ios && !standalone ? Math.min(Math.max(window.outerHeight - window.innerHeight - 60, 0), BLEED) : 0
    root.setProperty('--bleed', `${BLEED}px`)
    root.setProperty('--under-bar', `${underBar}px`)
    root.setProperty('--vh', `${window.innerHeight}px`)
    if (Math.abs(window.scrollY - BLEED) > 0.5) window.scrollTo(0, BLEED)
  }
  sync()
  window.addEventListener('resize', sync)
  window.addEventListener('scroll', sync)

  // The page never zooms: a pinch belongs to the scene (the grid of projects). iOS ignores
  // the viewport's say on this, so multi-finger moves and Safari's gesture events are refused
  // here, which also keeps the browser from cancelling the scene's pointer events mid-pinch.
  const refuse = (e: Event) => e.preventDefault()
  window.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false })
  window.addEventListener('gesturestart', refuse)
  window.addEventListener('gesturechange', refuse)
}

const size = new THREE.Vector2()

/** Size the renderer to the bled canvas while keeping `fov` across the visible viewport. */
export function fitToScreen(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, fov: number) {
  const w = window.innerWidth
  const h = window.innerHeight
  const full = h + 2 * BLEED
  // only touch the drawing buffer when the size really changed: setting it again, even to the
  // same size, throws the buffer away and allocates a new one, which costs a whole frame
  renderer.getSize(size)
  if (size.x !== w || size.y !== full) renderer.setSize(w, full, false)
  camera.aspect = w / full
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(fov / 2)) * full) / h))
  camera.updateProjectionMatrix()
}

/** Safari tints its bars with the page background, so keep it in step with the scene. */
export function setPageColor(color: string) {
  document.documentElement.style.backgroundColor = color
  document.body.style.backgroundColor = color
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}
