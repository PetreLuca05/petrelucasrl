// a step no longer than this keeps the integration stable for the stiffest springs in use
const MAX_STEP = 1 / 90

/**
 * A damped spring: a value that is pulled toward a target, overshooting a little on the way
 * when `damping` is below 1. Everything that pops, lands or settles in the scene runs on one
 * of these, so motion carries momentum instead of easing along a fixed curve.
 */
export class Spring {
  value: number
  velocity = 0

  constructor(value = 0) {
    this.value = value
  }

  /**
   * Advance by `dt` seconds toward `target`. `frequency` (radians per second) sets how fast
   * it moves; `damping` below 1 lets it overshoot, 1 brings it to rest without overshooting.
   * Snaps onto the target once it is as good as there, so `value === target` can be tested.
   */
  update(target: number, dt: number, frequency: number, damping = 0.7) {
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      const acceleration = -frequency * frequency * (this.value - target) - 2 * damping * frequency * this.velocity
      this.velocity += acceleration * h
      this.value += this.velocity * h
    }
    if (Math.abs(this.value - target) < 1e-3 && Math.abs(this.velocity) < 1e-2) {
      this.value = target
      this.velocity = 0
    }
    return this.value
  }
}
