// how fast the wheel catches up with the finger, per second (see scroller.ts for why)
const FOLLOW = 80
// how quickly a flung wheel slows, per second; sets how far a flick carries it
const FRICTION = 3
// stiffness of the pull toward the nearest card, per second, and its damping: below 1 the
// wheel overshoots a little and swings back, like something with weight
const SNAP = 9
const SNAP_DAMPING = 0.72
// the fling speed is measured over the finger's last few samples, this far back (ms)
const VELOCITY_WINDOW_MS = 100
// a finger that paused this long before lifting leaves no fling behind
const FLING_WINDOW_MS = 80
// radians per second
const MAX_VELOCITY = 12
// mouse-wheel travel that counts as one card, and the pause before the next one may follow
const TICK_PIXELS = 60
const TICK_GAP_MS = 220

const TAU = Math.PI * 2

/**
 * The turning of the wheel of projects: `count` cards spaced evenly around it, spun by a
 * finger or a mouse wheel, always coming to rest with one card at the front. Pure motion;
 * the scene reads `angleOf` each frame to place the cards.
 */
export function createWheel(count: number) {
  const step = TAU / count
  let angle = 0
  // where the finger has turned it to (the wheel follows a little behind)
  let want = 0
  let velocity = 0
  // the angle the wheel is settling toward, or null once it is there
  let target: number | null = null
  let dragging = false
  let samples: { t: number; a: number }[] = []
  let scrolled = 0
  let tickAt = 0

  const nearest = (a: number) => Math.round(a / step) * step
  const clamp = (v: number) => Math.max(Math.min(v, MAX_VELOCITY), -MAX_VELOCITY)

  const turn = (n: number) => {
    dragging = false
    target = nearest(target ?? angle) + n * step
  }

  return {
    /** The card facing the viewer: the one whose angle is closest to the front. */
    get selected() {
      return ((-Math.round(angle / step)) % count + count) % count
    },
    /** Where card `i` is around the wheel, in radians; 0 is the front, positive is up. */
    angleOf(i: number) {
      return i * step + angle
    },
    beginDrag(time: number) {
      dragging = true
      velocity = 0
      target = null
      want = angle
      samples = [{ t: time, a: want }]
    },
    /** The finger turned the wheel by `delta` radians. */
    drag(delta: number, time: number) {
      if (!dragging) return
      want += delta
      samples.push({ t: time, a: want })
      while (samples.length > 2 && time - samples[1].t > VELOCITY_WINDOW_MS) samples.shift()
    },
    endDrag(time: number) {
      if (!dragging) return
      dragging = false
      const last = samples[samples.length - 1]
      const first = samples[0]
      const span = (last.t - first.t) / 1000
      velocity = time - last.t > FLING_WINDOW_MS || span <= 0 ? 0 : clamp((last.a - first.a) / span)
      // come to rest where the fling would have carried the wheel, on the card nearest there
      target = nearest(angle + velocity / FRICTION)
    },
    /** Mouse-wheel travel in pixels; every so many turns the wheel by one card. */
    scroll(deltaY: number, time: number) {
      if (Math.sign(deltaY) !== Math.sign(scrolled)) scrolled = 0
      scrolled += deltaY
      if (Math.abs(scrolled) < TICK_PIXELS || time - tickAt < TICK_GAP_MS) return
      turn(Math.sign(scrolled))
      scrolled = 0
      tickAt = time
    },
    /** Bring card `i` to the front, the short way round. */
    snapTo(i: number) {
      dragging = false
      const from = target ?? angle
      const front = -i * step
      target = front + Math.round((from - front) / TAU) * TAU
    },
    update(dt: number) {
      if (dragging) {
        angle += (want - angle) * (1 - Math.exp(-dt * FOLLOW))
      } else if (target !== null) {
        // a spring that keeps whatever momentum the fling had
        const away = angle - target
        velocity += (-2 * SNAP_DAMPING * SNAP * velocity - SNAP * SNAP * away) * dt
        angle += velocity * dt
        if (Math.abs(angle - target) < 1e-4 && Math.abs(velocity) < 1e-3) {
          angle = target
          velocity = 0
          target = null
        }
      }
    },
  }
}
