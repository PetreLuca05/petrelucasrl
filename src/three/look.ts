import * as THREE from 'three'

type OrientationCtor = { requestPermission?: () => Promise<string> }

let motionDecided = false

/**
 * iOS only hands out device orientation after a user gesture, and only asks once per page:
 * call this from every tap handler and it keeps asking until the visitor has answered.
 */
export function requestMotionPermission() {
  if (motionDecided) return
  const ctor = (window as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent
  if (!ctor?.requestPermission) {
    motionDecided = true
    return
  }
  ctor
    .requestPermission()
    .then((state) => {
      if (state === 'granted' || state === 'denied') motionDecided = true
    })
    .catch(() => {})
}

// how much of a phone tilt reaches the camera, and the most it may ever add (radians)
const TILT_GAIN = 0.25
const MAX_TILT_YAW = 0.1
const MAX_TILT_PITCH = 0.07
// how fast the lean follows the phone, per second; takes the edge off sensor noise
const LEAN_FOLLOW = 12
// how fast the resting pose drifts toward how the phone is being held, per second
const REST_DRIFT = 0.6
// a change bigger than this between two sensor readings is a glitch, not a movement (radians)
const GLITCH = THREE.MathUtils.degToRad(12)
// sensor readings further apart than this in time are not compared (ms)
const SENSOR_GAP = 400
// how far the view turns per pixel dragged, relative to the scene moving 1:1 with the finger
const PAN_SPEED = 1.7
// amplitude of the always-on handheld shake (radians)
const SHAKE = 0.004

const { clamp, damp, degToRad } = THREE.MathUtils
// the difference between two angles, taken the short way round
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

/**
 * Camera look controller. In 'drag' mode panning with a finger or the mouse turns the view.
 * On top of that the view leans a little: with the phone's tilt where there is a gyroscope,
 * otherwise toward the pointer while in 'parallax' mode. The lean never steers the camera.
 */
export function createLook(camera: THREE.PerspectiveCamera) {
  let mode: 'parallax' | 'drag' = 'parallax'
  const target = new THREE.Quaternion()
  const euler = new THREE.Euler()

  // how the phone is held: rolled to the side and tipped back, in radians (see onOrientation)
  let tilt: { side: number; front: number } | null = null
  let tiltAt = 0
  // resting pose the tilt is measured from; drifts toward how the phone is being held
  let rest: { side: number; front: number } | null = null
  let lastAngle = window.screen.orientation?.angle ?? 0
  let leanYaw = 0
  let leanPitch = 0
  // the direction the view rests in: straight ahead, or tipped down to look at the grid
  let basePitch = 0
  let basePitchTarget = 0
  let lastT: number | null = null
  let pointerX = 0
  let pointerY = 0
  let dragYaw = 0
  let dragPitch = 0
  // the pointer that is panning, if any; other fingers are ignored
  let dragId: number | null = null
  const sway = { yaw: 0, pitch: 0, roll: 0 }
  let pan = true
  let lastX = 0
  let lastY = 0

  // The browser reports the tilt as two Euler angles, beta and gamma, which flip and spin
  // whenever the phone is held close to upright, the most common way to hold it. Instead the
  // tilt is taken from where "up" points in the phone's own axes, which moves smoothly however
  // the phone is held: how far it is rolled to the side, and how far it is tipped back.
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return
    const beta = degToRad(e.beta)
    const gamma = degToRad(e.gamma)
    const upX = -Math.cos(beta) * Math.sin(gamma)
    const upY = Math.sin(beta)
    const upZ = Math.cos(beta) * Math.cos(gamma)
    const side = Math.asin(clamp(-upX, -1, 1))
    const front = Math.atan2(upY, upZ)
    const now = performance.now()
    if (tilt && rest && now - tiltAt < SENSOR_GAP) {
      // a sudden leap between two readings is a sensor glitch: carry the resting pose along
      // with it so nothing on screen moves
      const dSide = wrap(side - tilt.side)
      const dFront = wrap(front - tilt.front)
      if (Math.abs(dSide) > GLITCH || Math.abs(dFront) > GLITCH) {
        rest.side += dSide
        rest.front += dFront
      }
    } else if (tilt && rest) {
      // readings resumed after a pause: start again from how the phone is held now
      rest = { side, front }
    }
    tilt = { side, front }
    tiltAt = now
  }

  const onDown = (e: PointerEvent) => {
    if (dragId !== null) return
    dragId = e.pointerId
    lastX = e.clientX
    lastY = e.clientY
  }

  const onMove = (e: PointerEvent) => {
    pointerX = (e.clientX / window.innerWidth) * 2 - 1
    pointerY = (e.clientY / window.innerHeight) * 2 - 1
    if (e.pointerId !== dragId) return
    if (mode === 'drag' && pan) {
      const perPixel = (degToRad(camera.fov) / window.innerHeight) * PAN_SPEED
      dragYaw += (e.clientX - lastX) * perPixel
      dragPitch = clamp(dragPitch + (e.clientY - lastY) * perPixel, -1, 1)
    }
    lastX = e.clientX
    lastY = e.clientY
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId === dragId) dragId = null
  }

  window.addEventListener('deviceorientation', onOrientation)
  window.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)

  return {
    /** Leaving 'drag' turns the view back to straight ahead. */
    setMode(next: 'parallax' | 'drag') {
      mode = next
      if (mode === 'parallax') {
        dragYaw = 0
        dragPitch = 0
      }
    },
    /** Everything but the panning: the tilt lean plus the handheld shake, in radians. */
    sway,
    /** Panning is switched off while something on screen needs the drag gesture for itself. */
    setPan(enabled: boolean) {
      pan = enabled
    },
    /** Tip the resting view up or down by `angle` radians (negative looks down); it swings there smoothly. */
    setBasePitch(angle: number) {
      basePitchTarget = angle
    },
    /** `t` in seconds, for the handheld shake. */
    update(t: number) {
      const dt = lastT === null ? 0 : clamp(t - lastT, 0, 0.1)
      lastT = t
      let wantYaw = 0
      let wantPitch = 0
      if (tilt) {
        // turning the screen swaps the phone's axes; measure afresh from the new pose
        const angle = window.screen.orientation?.angle ?? 0
        if (angle !== lastAngle) {
          lastAngle = angle
          rest = null
        }
        rest ??= { ...tilt }
        const follow = 1 - Math.exp(-dt * REST_DRIFT)
        rest.side += wrap(tilt.side - rest.side) * follow
        rest.front += wrap(tilt.front - rest.front) * follow
        let side = wrap(tilt.side - rest.side)
        let front = wrap(tilt.front - rest.front)
        // in landscape the phone's axes swap places on screen
        if (angle === 90) [side, front] = [front, -side]
        else if (angle === 270) [side, front] = [-front, side]
        wantYaw = clamp(side * TILT_GAIN, -MAX_TILT_YAW, MAX_TILT_YAW)
        wantPitch = clamp(front * TILT_GAIN, -MAX_TILT_PITCH, MAX_TILT_PITCH)
      } else if (mode === 'parallax') {
        wantYaw = -pointerX * 0.12
        wantPitch = -pointerY * 0.08
      }
      leanYaw = damp(leanYaw, wantYaw, LEAN_FOLLOW, dt)
      leanPitch = damp(leanPitch, wantPitch, LEAN_FOLLOW, dt)
      basePitch = damp(basePitch, basePitchTarget, 4, dt)
      // a slow, slightly irregular wobble, as if the camera were held by hand
      const shakeYaw = (Math.sin(t * 1.3) + Math.sin(t * 2.9 + 1.7) * 0.5) * SHAKE
      const shakePitch = (Math.sin(t * 1.7 + 0.6) + Math.sin(t * 3.7 + 4.1) * 0.5) * SHAKE
      const shakeRoll = Math.sin(t * 1.1 + 2.3) * SHAKE * 0.6
      sway.yaw = leanYaw + shakeYaw
      sway.pitch = leanPitch + shakePitch
      sway.roll = shakeRoll
      euler.set(basePitch + dragPitch + sway.pitch, dragYaw + sway.yaw, sway.roll, 'YXZ')
      target.setFromEuler(euler)
      // eased by time, not by frame, so it feels the same at 60 and 120 frames a second
      camera.quaternion.slerp(target, 1 - Math.exp(-dt * (mode === 'drag' ? 14 : 5)))
    },
    dispose() {
      window.removeEventListener('deviceorientation', onOrientation)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    },
  }
}
