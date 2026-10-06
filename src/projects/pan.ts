// how fast the grid catches up with the finger, per second (see scroller.ts for why)
const FOLLOW = 80
// how quickly a flung grid slows down, per second
const FRICTION = 2.6
// how much faster it slows while past an edge
const EDGE_FRICTION = 18
// how far past an edge a drag goes for each unit of finger travel
const EDGE_GIVE = 0.35
// how quickly it springs back from past an edge, per second
const SPRING = 14
// the fling speed is measured over the finger's last few samples, this far back (ms)
const VELOCITY_WINDOW_MS = 100
// a finger that paused this long before lifting leaves no fling behind
const FLING_WINDOW_MS = 80

type Axis = { value: number; want: number; velocity: number; min: number; max: number }

const axis = (): Axis => ({ value: 0, want: 0, velocity: 0, min: 0, max: 0 })
const clamp = (a: Axis, v: number) => Math.min(Math.max(v, a.min), a.max)

/**
 * Sliding a flat sheet about on two axes with a finger or the mouse wheel, and bringing it
 * nearer or farther with a pinch: it follows the fingers, coasts when flung, gives a little
 * past its edges and springs back. Pure motion in world units; the scene reads `x`, `y` and
 * `depth` each frame.
 */
export function createPan() {
  const x = axis()
  const y = axis()
  // how far the sheet is from the eye: pinching changes it, within a range
  const depth = axis()
  let dragging = false
  let pinching = false
  let pinchDistance = 1
  let pinchDepth = 1
  let samples: { t: number; x: number; y: number }[] = []

  // a value pushed past its range gives way only partly, like a drag past an edge
  const give = (a: Axis, v: number) => (v < a.min ? a.min - (a.min - v) * EDGE_GIVE : v > a.max ? a.max + (v - a.max) * EDGE_GIVE : v)

  const step = (a: Axis, dt: number, held: boolean) => {
    if (held) {
      a.value += (a.want - a.value) * (1 - Math.exp(-dt * FOLLOW))
      return
    }
    const inside = clamp(a, a.value)
    const outside = a.value - inside
    if (a.velocity !== 0) {
      a.value += a.velocity * dt
      a.velocity *= Math.exp(-dt * (outside !== 0 ? EDGE_FRICTION : FRICTION))
      if (Math.abs(a.velocity) < 0.01) a.velocity = 0
    }
    if (outside !== 0) {
      const target = clamp(a, a.value)
      a.value += (target - a.value) * (1 - Math.exp(-dt * SPRING))
      if (Math.abs(target - a.value) < 0.002 && Math.abs(a.velocity) < 0.3) {
        a.value = target
        a.velocity = 0
      }
    }
    a.want = a.value
  }

  return {
    get x() {
      return x.value
    },
    get y() {
      return y.value
    },
    get depth() {
      return depth.value
    },
    /** Where the pinch has put the depth, which the drawn depth is still catching up with. */
    get wantedDepth() {
      return depth.want
    },
    /** How near and how far the sheet may be brought, and where it starts. */
    setDepthRange(min: number, max: number, start: number) {
      depth.min = min
      depth.max = max
      depth.value = depth.want = start
    },
    /** Two fingers are down, this far apart (px). */
    beginPinch(distance: number) {
      pinching = true
      pinchDistance = Math.max(distance, 1)
      pinchDepth = depth.want
    },
    /** The fingers are now this far apart: spreading them brings the sheet nearer. */
    pinch(distance: number) {
      if (!pinching) return
      depth.want = give(depth, (pinchDepth * pinchDistance) / Math.max(distance, 1))
    },
    endPinch() {
      pinching = false
    },
    /** A zoom step from a trackpad pinch or a wheel: `factor` above 1 moves the sheet away. */
    zoomBy(factor: number) {
      depth.value = depth.want = clamp(depth, depth.value * factor)
    },
    /** How far the sheet may slide each way; it may be dragged a little past these. */
    setBounds(minX: number, maxX: number, minY: number, maxY: number) {
      x.min = minX
      x.max = maxX
      y.min = minY
      y.max = maxY
    },
    beginDrag(time: number) {
      dragging = true
      x.velocity = y.velocity = 0
      x.want = x.value
      y.want = y.value
      samples = [{ t: time, x: x.want, y: y.want }]
    },
    /** The finger moved the sheet by (dx, dy). */
    drag(dx: number, dy: number, time: number) {
      if (!dragging) return
      // past an edge the sheet follows the finger only part of the way
      x.want += x.want < x.min || x.want > x.max ? dx * EDGE_GIVE : dx
      y.want += y.want < y.min || y.want > y.max ? dy * EDGE_GIVE : dy
      samples.push({ t: time, x: x.want, y: y.want })
      while (samples.length > 2 && time - samples[1].t > VELOCITY_WINDOW_MS) samples.shift()
    },
    endDrag(time: number) {
      if (!dragging) return
      dragging = false
      const last = samples[samples.length - 1]
      const first = samples[0]
      const span = (last.t - first.t) / 1000
      if (time - last.t > FLING_WINDOW_MS || span <= 0) return
      x.velocity = (last.x - first.x) / span
      y.velocity = (last.y - first.y) / span
    },
    /** A nudge from the mouse wheel, straight to the sheet. */
    nudge(dx: number, dy: number) {
      x.value = x.want = clamp(x, x.value + dx)
      y.value = y.want = clamp(y, y.value + dy)
      x.velocity = y.velocity = 0
    },
    update(dt: number) {
      step(x, dt, dragging)
      step(y, dt, dragging)
      step(depth, dt, pinching)
    },
  }
}
