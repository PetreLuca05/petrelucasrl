// How fast the text catches up with the finger, per second. Pointer events do not arrive in
// step with frames, so following them directly makes the text judder; this light lag (about
// 12 ms) smooths that out without the text feeling detached from the finger.
const FOLLOW = 80
// how quickly a flung list slows down, per second (iOS feel is about 2)
const FRICTION = 2.2
// how much faster it slows while past either end
const EDGE_FRICTION = 18
// how far past an end a drag goes for each pixel of finger travel
const EDGE_GIVE = 0.35
// how quickly the list springs back from past an end, per second
const SPRING = 14
const MAX_VELOCITY = 5000
// the fling speed is measured over the finger's last few samples, this far back (ms)
const VELOCITY_WINDOW_MS = 100
// a finger that paused this long before lifting leaves no fling behind
const FLING_WINDOW_MS = 80
const SETTLE_SECONDS = 0.45

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/**
 * Scrolls a column of text by hand: the finger (or wheel) moves `content` inside `viewport`
 * with a transform, with the usual fling and spring back at the ends. Everything is moved
 * once per frame, never from inside an input event.
 *
 * It replaces a native scroller on purpose. On iOS a native scroll is tracked by the system,
 * which stops handing out the gyroscope while the finger is down and while the list is still
 * coasting afterwards, so the camera's lean froze on every scroll. A transform moved from
 * script never leaves the page, and the sensors keep flowing.
 */
export function createScroller(viewport: HTMLElement, content: HTMLElement, onChange: (y: number) => void) {
  // where the text is drawn, and where the finger has put it (the text follows a little behind)
  let y = 0
  let want = 0
  // px per second, positive when the text moves up
  let velocity = 0
  // the finger (or mouse) that is dragging, if any; other fingers are ignored
  let dragId: number | null = null
  let lastY = 0
  // the finger's recent positions, for measuring the fling
  let samples: { t: number; y: number }[] = []
  let frame = 0
  let lastFrame = 0
  let drawn = NaN
  let tween: { from: number; to: number; start: number; done: () => void } | null = null
  // the stretch at the top a single wheel step crosses in one go (see setSnap)
  let snap = 0

  const max = () => Math.max(content.offsetHeight - viewport.clientHeight, 0)
  const clamp = (value: number) => Math.min(Math.max(value, 0), max())

  const apply = () => {
    const rounded = Math.round(y * 100) / 100
    if (rounded === drawn) return
    drawn = rounded
    content.style.transform = `translate3d(0, ${-rounded}px, 0)`
    onChange(rounded)
  }

  const step = (time: number) => {
    frame = 0
    const dt = Math.min((time - lastFrame) / 1000, 0.1)
    lastFrame = time
    let moving = false
    if (tween) {
      const k = Math.min((time - tween.start) / (SETTLE_SECONDS * 1000), 1)
      y = want = tween.from + (tween.to - tween.from) * easeInOutCubic(k)
      if (k < 1) moving = true
      else {
        const { done } = tween
        tween = null
        done()
      }
    } else if (dragId !== null) {
      y += (want - y) * (1 - Math.exp(-dt * FOLLOW))
      if (Math.abs(want - y) < 0.05) y = want
      // keep going while the finger is down, so a move always shows on the very next frame
      moving = true
    } else {
      const inside = clamp(y)
      const outside = y - inside
      if (velocity !== 0) {
        y += velocity * dt
        velocity *= Math.exp(-dt * (outside !== 0 ? EDGE_FRICTION : FRICTION))
        if (Math.abs(velocity) < 2) velocity = 0
        moving = true
      }
      if (outside !== 0) {
        // spring back from past the end, letting a fling overshoot a little first
        const target = clamp(y)
        y += (target - y) * (1 - Math.exp(-dt * SPRING))
        if (Math.abs(target - y) < 0.3 && Math.abs(velocity) < 60) {
          y = target
          velocity = 0
        }
        moving = true
      }
      want = y
    }
    apply()
    if (moving) frame = requestAnimationFrame(step)
  }

  const run = () => {
    if (frame) return
    lastFrame = performance.now()
    frame = requestAnimationFrame(step)
  }

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || dragId !== null) return
    dragId = e.pointerId
    velocity = 0
    tween = null
    want = y
    lastY = e.clientY
    samples = [{ t: e.timeStamp, y: want }]
    run()
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return
    let dy = lastY - e.clientY
    lastY = e.clientY
    // past either end the list follows the finger only part of the way
    if (want < 0 || want > max()) dy *= EDGE_GIVE
    want += dy
    samples.push({ t: e.timeStamp, y: want })
    while (samples.length > 2 && e.timeStamp - samples[1].t > VELOCITY_WINDOW_MS) samples.shift()
    run()
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return
    dragId = null
    const last = samples[samples.length - 1]
    const first = samples[0]
    const span = (last.t - first.t) / 1000
    if (e.timeStamp - last.t > FLING_WINDOW_MS || span <= 0) velocity = 0
    else velocity = Math.max(Math.min((last.y - first.y) / span, MAX_VELOCITY), -MAX_VELOCITY)
    run()
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    tween = null
    velocity = 0
    // inside the snap stretch one step goes all the way across it, down or back up
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
    if (delta > 0 && y < snap) y = want = clamp(snap)
    else if (delta < 0 && y <= snap + 0.5) y = want = 0
    else y = want = clamp(y + delta)
    run()
  }

  viewport.addEventListener('pointerdown', onDown)
  viewport.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)

  return {
    /** Pixels the text has moved up. */
    get y() {
      return y
    },
    /**
     * The first `distance` px are crossed by a single wheel step: down from the top lands at
     * `distance`, and up from anywhere up to it lands back at the top. Fingers are unaffected.
     */
    setSnap(distance: number) {
      snap = distance
    },
    /** Jump straight back to the top, without animating. */
    reset() {
      tween = null
      velocity = 0
      y = want = 0
      apply()
    },
    /** Glide to `to` and call `done` once there. */
    scrollTo(to: number, done: () => void) {
      dragId = null
      velocity = 0
      tween = { from: y, to: clamp(to), start: performance.now(), done }
      run()
    },
    dispose() {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('pointerdown', onDown)
      viewport.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    },
  }
}
