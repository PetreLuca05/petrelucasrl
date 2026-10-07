import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createLogo } from './landing/logo.ts'
import { createTitle } from './landing/title.ts'
import { createCard } from './projects/card.ts'
import { createLens } from './projects/lens.ts'
import type { Insert, Project } from './projects/data.ts'
import { createInserts } from './projects/inserts.ts'
import { createPan } from './projects/pan.ts'
import { createWheel } from './projects/wheel.ts'
import { createLook } from './three/look.ts'
import { createSphere } from './three/sphere.ts'
import { Spring } from './three/spring.ts'
import { BLEED, fitToScreen } from './three/viewport.ts'

/**
 * 'projects' is the ring of cards around the viewer, 'wheel' the wheel of cards in front, and
 * 'grid' the cards laid out flat below, seen from above.
 */
export type View = 'landing' | 'projects' | 'wheel' | 'grid'

const FOV = 75
const TITLE_DISTANCE = 5
const SPHERE_RADIUS = 12
const CARD_DISTANCE = 4
// The wheel of projects: cards around a circle in front of the camera, facing outward, the
// front one CARD_DISTANCE away like a card of the ring. Its smallest radius (it grows with
// the number of cards so they never overlap), and how far the rest of the wheel sinks while
// one card is open.
const WHEEL_RADIUS = 2.6
const WHEEL_SINK = 1.2
// The grid of projects: cards lying flat this far below the camera, which looks straight
// down at them, this many across, drawn at this share of their ring size, this far apart.
// A pinch brings them nearer or farther, between the two shares of that depth.
const GRID_DEPTH = 6.2
const GRID_NEAREST = 0.45
const GRID_FARTHEST = 1.8
const GRID_COLUMNS = 3
const GRID_CARD_SCALE = 0.62
const GRID_GAP = 0.3
const MIN_HORIZONTAL_FOV = 58
const FOCUS_SCALE = 0.12
// how far (radians) the aimed-at card tips back when the crosshair is at its very edge
const PRESS_TILT = 0.3
const CARD_STAGGER = 0.025
const CARD_ENTER = 0.3
// where an open card sits on screen, in CSS pixels
const DETAIL_TOP = 72
const DETAIL_MAX_WIDTH = 560
// how far the page's copy of an open card rises as the "Projects" label scrolls away above it
const DETAIL_RISE = 58
// How much of the camera's lean and shake an open card (and the page content that goes with
// it) shows: 0 would pin it to the screen, 1 would leave it hanging in the dome like the ring.
const DETAIL_SWAY = 0.35
// the page's own copy of an open card can shrink to this share of its height (see index.css)
const DETAIL_MIN_SCALE = 0.5

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
// eases out with a little overshoot, like something arriving on a spring
const easeOutBack = (x: number, overshoot = 1.4) => 1 + (overshoot + 1) * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2)
const { clamp, damp, degToRad, radToDeg } = THREE.MathUtils

/**
 * The whole site is one scene: the title in the dark, the white dome that closes around the
 * view, and the project cards inside it. Views only change what is animated in, nothing is rebuilt.
 */
export function createScene(
  canvas: HTMLCanvasElement,
  projects: Project[],
  onDetail: (index: number | null) => void,
  onExit: () => void,
  onCloseRequest: () => void,
  onSway: (transform: string) => void,
) {
  // The dome paints every pixel, backdrop included, so the canvas is opaque: nothing is
  // blended with the page behind it, and the browser has no second layer to composite.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.autoClear = false
  // the toon-shaded models in the write-ups cast shadows on themselves; nothing else casts any,
  // so the main scene never draws a shadow map
  renderer.shadowMap.enabled = true

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100)
  const look = createLook(camera)

  const count = projects.length
  // The ring: one row of cards around the viewer, or two rows once there are too many for
  // the cards to stay a good size. Each column of the ring is a section of the dome.
  const rows = count > 8 ? 2 : 1
  const columns = Math.ceil(count / rows)
  const sphere = createSphere()
  sphere.scale.setScalar(SPHERE_RADIUS)
  sphere.material.uniforms.uSections.value = columns
  scene.add(sphere)

  // soft studio surroundings for the steel logo to reflect; nothing else in the scene is lit
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = environment

  // the 3D models set into the write-ups, drawn behind the page while a card is open
  const inserts = createInserts(renderer)
  const insertsAmount = new Spring()
  setTimeout(() => inserts.preload(projects.flatMap((project) => project.inserts ?? [])), 1500)

  // the logo above the company name, moving together
  const brand = new THREE.Group()
  brand.position.z = -TITLE_DISTANCE
  scene.add(brand)
  const title = createTitle()
  const logo = createLogo()
  brand.add(title.group, logo.group)

  // u is the sphere's texture coordinate around the vertical axis; 0.75 is straight ahead
  const sectionU = (i: number) => 0.75 - Math.floor(i / rows) / columns
  const cardAngle = degToRad(Math.min(44, (360 / columns) * 0.75))
  const cardWidth = 2 * CARD_DISTANCE * Math.tan(cardAngle / 2)
  const cardHeight = cardWidth / 2
  // the wheel is as big as it has to be for its cards to sit clear of each other
  const wheelRadius = Math.max(WHEEL_RADIUS, (cardHeight * 1.3 * count) / (2 * Math.PI))
  const cardRing = new THREE.Group()
  cardRing.visible = false
  scene.add(cardRing)
  const cards = projects.map((project, i) => {
    const card = createCard(project, i, cardWidth, { ring: CARD_DISTANCE, wheel: wheelRadius }, renderer)
    const phi = sectionU(i) * Math.PI * 2
    // with two rows, the cards of a column sit one above the other
    const y = rows === 1 ? 0 : (i % 2 === 0 ? 0.56 : -0.56) * cardHeight
    card.group.position.set(-Math.cos(phi) * CARD_DISTANCE, y, Math.sin(phi) * CARD_DISTANCE)
    card.group.lookAt(0, y, 0)
    cardRing.add(card.group)
    return card
  })
  // the cards' places in the ring
  const homes = cards.map((card) => ({
    position: card.group.position.clone(),
    quaternion: card.group.quaternion.clone(),
  }))
  // and on the wheel, worked out each frame from how far it has turned
  const wheel = createWheel(count)
  const wheelPosition = new THREE.Vector3()
  const wheelQuaternion = new THREE.Quaternion()
  const wheelEuler = new THREE.Euler()
  const placeOnWheel = (i: number) => {
    const phi = wheel.angleOf(i)
    wheelPosition.set(0, wheelRadius * Math.sin(phi), wheelRadius * (Math.cos(phi) - 1) - CARD_DISTANCE)
    // facing away from the wheel's centre, so the front card faces the camera
    wheelQuaternion.setFromEuler(wheelEuler.set(-phi, 0, 0))
  }
  // and on the grid below, which slides about under the finger
  const pan = createPan()
  pan.setDepthRange(GRID_DEPTH * GRID_NEAREST, GRID_DEPTH * GRID_FARTHEST, GRID_DEPTH)
  const gridRows = Math.ceil(count / GRID_COLUMNS)
  const gridPitchX = cardWidth * GRID_CARD_SCALE + GRID_GAP
  const gridPitchZ = cardHeight * GRID_CARD_SCALE + GRID_GAP
  // it slides just far enough for the lens at the centre to reach every card
  pan.setBounds(
    (-(GRID_COLUMNS - 1) / 2) * gridPitchX,
    ((GRID_COLUMNS - 1) / 2) * gridPitchX,
    (-(gridRows - 1) / 2) * gridPitchZ,
    ((gridRows - 1) / 2) * gridPitchZ,
  )
  const gridPosition = new THREE.Vector3()
  // lying flat, its top toward the far side, which is up on the screen when looking down
  const gridQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
  const placeOnGrid = (i: number) => {
    const column = i % GRID_COLUMNS
    const row = Math.floor(i / GRID_COLUMNS)
    // looking down, up on the screen is toward negative z, so the first row goes there
    gridPosition.set(
      (column - (GRID_COLUMNS - 1) / 2) * gridPitchX + pan.x,
      -pan.depth,
      (row - (gridRows - 1) / 2) * gridPitchZ + pan.y,
    )
  }
  // which arrangement the cards are in; only changes while none of them is showing
  let cardsMode: 'ring' | 'wheel' | 'grid' = 'ring'
  const bodies = cards.map((card) => card.body)
  // how far each card is the chosen one, 0 to 1, popping up and down on a spring
  const focus = cards.map(() => new Spring())
  // where the crosshair presses each card, -1..1 from its centre; springs back when it leaves
  const press = cards.map(() => ({ x: new Spring(), y: new Spring() }))
  const pressAt = new THREE.Vector2()
  const pressTilt = new THREE.Quaternion()
  const pressEuler = new THREE.Euler()
  const cardsDuration = 0.1 + (count - 1) * CARD_STAGGER + CARD_ENTER

  let view: View = 'landing'
  // 0 on the landing, 1 once the projects have taken over the inside of the sphere
  let inside = 0
  let cardsTime = 0
  let showWheel = false
  let showGrid = false
  // the dome's sections belong to the ring; this fades them out on the wheel
  let ringAmount = 0
  let focused: number | null = null
  let titleScale = 1
  // the open card: `detail` while it is open, `detailCard` until it has flown back home, and
  // how far along its flight it is, 0 at home to 1 in front of the camera, on a spring that
  // overshoots a little either way
  let detail: number | null = null
  let detailCard = -1
  const flight = new Spring()
  let detailBlend = 0
  const detailPosition = new THREE.Vector3()
  // layout of the open card, refreshed on resize: its distance from the camera, the height
  // visible at that distance, and its height on screen in CSS pixels
  let detailDistance = 1
  let detailVisibleHeight = 1
  let detailCardPixels = 1
  // seconds the open card has been in place; the page's copy takes over shortly after
  let detailArrived = 0
  let visibleFov = FOV
  const swayEuler = new THREE.Euler()
  const swayQuaternion = new THREE.Quaternion()
  const swayMatrix = new THREE.Matrix4()
  const swayShift = new THREE.Matrix4()
  let swaying = false

  // Taps do all the navigating among the projects. In the ring: on the card under the lens to
  // open it, on empty space to leave. On the wheel: on the front card to open it, on another
  // card to bring it round, on empty space to leave. Anywhere on the scene closes an open
  // card. A tap is a press that lifts again without having moved, so panning or turning the
  // wheel never counts. Only the first finger down is followed.
  let pressX = 0
  let pressY = 0
  let pressId: number | null = null
  let lastDragX = 0
  let lastDragY = 0
  // every finger on the screen; two of them over the grid make a pinch
  const fingers = new Map<number, { x: number; y: number }>()
  let pinching = false
  // set for the rest of a touch that pinched at any point: lifting its last finger is no tap
  let pinched = false
  let lastMidX = 0
  let lastMidY = 0
  // world units a pixel of finger travel moves something `distance` away
  const worldPerPixel = (distance: number) => (2 * distance * Math.tan(degToRad(visibleFov / 2))) / window.innerHeight
  const pinchGeometry = () => {
    const [a, b] = [...fingers.values()]
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 }
  }
  let tapped = false
  // where the tap landed, in the camera's -1..1 coordinates
  const tapAt = new THREE.Vector2()
  const onPress = (e: PointerEvent) => {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.size === 1) pinched = false
    if (showGrid && detail === null && fingers.size === 2) {
      // a second finger over the grid: from here on the pair pinches and slides together
      const { distance, midX, midY } = pinchGeometry()
      pinching = pinched = true
      pan.beginPinch(distance)
      pan.beginDrag(e.timeStamp)
      lastMidX = midX
      lastMidY = midY
      return
    }
    if (pressId !== null) return
    pressId = e.pointerId
    pressX = e.clientX
    pressY = e.clientY
    lastDragX = e.clientX
    lastDragY = e.clientY
    if (showWheel && detail === null) wheel.beginDrag(e.timeStamp)
    if (showGrid && detail === null) pan.beginDrag(e.timeStamp)
  }
  const onDrag = (e: PointerEvent) => {
    const finger = fingers.get(e.pointerId)
    if (finger) {
      finger.x = e.clientX
      finger.y = e.clientY
    }
    if (pinching && fingers.size >= 2) {
      const { distance, midX, midY } = pinchGeometry()
      // zoom about the point between the fingers: as the depth changes, slide the grid so
      // the card under that point stays under it; then follow the pair's own movement
      const before = pan.wantedDepth
      pan.pinch(distance)
      const after = pan.wantedDepth
      const perDepth = (2 * Math.tan(degToRad(visibleFov / 2))) / window.innerHeight
      const unit = worldPerPixel(after)
      pan.drag(
        (midX - lastMidX) * unit + (midX - window.innerWidth / 2) * perDepth * (after - before),
        (midY - lastMidY) * unit + (midY - window.innerHeight / 2) * perDepth * (after - before),
        e.timeStamp,
      )
      lastMidX = midX
      lastMidY = midY
      return
    }
    if (e.pointerId !== pressId) return
    if (showWheel && detail === null) {
      // the wheel turns with the finger: a pixel of travel moves the front card a pixel
      wheel.drag(((lastDragY - e.clientY) * worldPerPixel(CARD_DISTANCE)) / wheelRadius, e.timeStamp)
    }
    if (showGrid && detail === null) {
      // the grid slides under the finger; down the screen is away from the viewer
      const unit = worldPerPixel(pan.depth)
      pan.drag((e.clientX - lastDragX) * unit, (e.clientY - lastDragY) * unit, e.timeStamp)
    }
    lastDragX = e.clientX
    lastDragY = e.clientY
  }
  const onRelease = (e: PointerEvent) => {
    fingers.delete(e.pointerId)
    if (pinching) {
      if (fingers.size >= 2) return
      // the pinch is over; a finger still down carries on sliding the grid by itself
      pinching = false
      pan.endPinch()
      const [left] = [...fingers.entries()]
      if (left) {
        const [id, finger] = left
        pressId = id
        pressX = lastDragX = finger.x
        pressY = lastDragY = finger.y
        pan.beginDrag(e.timeStamp)
        return
      }
      pressId = null
      pan.endDrag(e.timeStamp)
      return
    }
    if (e.pointerId !== pressId) return
    pressId = null
    wheel.endDrag(e.timeStamp)
    pan.endDrag(e.timeStamp)
    if (!pinched && Math.hypot(e.clientX - pressX, e.clientY - pressY) < 8) {
      tapped = true
      // the canvas is bled above and below the screen (see three/viewport.ts)
      tapAt.set((e.clientX / window.innerWidth) * 2 - 1, 1 - ((e.clientY + BLEED) / (window.innerHeight + 2 * BLEED)) * 2)
    }
  }
  const onWheel = (e: WheelEvent) => {
    // the page never scrolls or zooms itself; the wheel belongs to the scene
    e.preventDefault()
    if (detail !== null) return
    const lines = e.deltaMode === 1 ? 16 : 1
    if (showWheel) wheel.scroll(e.deltaY * lines, e.timeStamp)
    if (showGrid) {
      // a trackpad pinch arrives as a wheel with ctrl held
      if (e.ctrlKey) return pan.zoomBy(Math.exp(e.deltaY * lines * 0.004))
      const unit = worldPerPixel(pan.depth)
      pan.nudge(-e.deltaX * lines * unit, -e.deltaY * lines * unit)
    }
  }
  canvas.addEventListener('pointerdown', onPress)
  canvas.addEventListener('pointermove', onDrag)
  canvas.addEventListener('pointerup', onRelease)
  canvas.addEventListener('pointercancel', onRelease)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  const closeDetail = () => {
    if (detail === null) return
    detail = null
    look.setPan(true)
    onDetail(null)
  }

  const resize = () => {
    const aspect = window.innerWidth / window.innerHeight
    // the projects view widens the lens on portrait screens so a whole card fits across
    const forWidth = radToDeg(2 * Math.atan(Math.tan(degToRad(MIN_HORIZONTAL_FOV / 2)) / aspect))
    const fov = FOV + (Math.max(FOV, forWidth) - FOV) * easeInOutCubic(inside)
    fitToScreen(renderer, camera, fov)
    visibleFov = fov
    renderer.getDrawingBufferSize(sphere.material.uniforms.uResolution.value)

    // An open card is held in front of the camera, pinned under the top bar. Work out where
    // that is in camera space and tell the page where the card ends so the text can start.
    // 8px of margin each side on a phone
    const fraction = Math.min(1 - 16 / window.innerWidth, DETAIL_MAX_WIDTH / window.innerWidth)
    const halfTan = Math.tan(degToRad(fov / 2))
    detailDistance = cardWidth / (fraction * 2 * halfTan * aspect)
    detailVisibleHeight = 2 * detailDistance * halfTan
    detailCardPixels = (fraction * window.innerWidth) / 2
    // The text list starts under the card's final spot (risen and collapsed) and is padded by
    // the distance the card still has to travel, so its first row sits under the full card
    // and then follows it up.
    const style = canvas.parentElement?.style
    const listTop = DETAIL_TOP - DETAIL_RISE + detailCardPixels * DETAIL_MIN_SCALE + 8
    style?.setProperty('--detail-top', `${Math.round(listTop)}px`)
    style?.setProperty('--detail-rise-room', `${DETAIL_RISE}px`)
    style?.setProperty('--detail-collapse', `${Math.round(detailCardPixels * (1 - DETAIL_MIN_SCALE))}px`)
    style?.setProperty('--detail-width', `${Math.round(fraction * window.innerWidth)}px`)
    style?.setProperty('--detail-card', `${Math.round(detailCardPixels)}px`)
    const centre = DETAIL_TOP + detailCardPixels / 2
    detailPosition.set(0, detailVisibleHeight * (0.5 - centre / window.innerHeight), -detailDistance)
    const visibleWidth = 2 * TITLE_DISTANCE * Math.tan(degToRad(FOV / 2)) * aspect
    titleScale = Math.min(visibleWidth * 0.6, 3.4) / 2
  }
  resize()
  window.addEventListener('resize', resize)

  const lens = createLens()

  // Draw everything once now, while the page is still loading, so every shader is linked and
  // every texture and buffer is on the GPU before the first frame the visitor sees. Doing it
  // the first time each thing is really needed would stall a frame mid-animation. The first
  // real frame paints over this one, since the dome covers every pixel.
  cardRing.visible = true
  renderer.clearDepth()
  renderer.render(scene, camera)
  lens.render(renderer, scene, camera, 1, 1)
  cardRing.visible = false

  let lensAmount = 0
  let now = 0
  let lensGlass = 0
  const glass = new Spring()
  const raycaster = new THREE.Raycaster()
  const scratch = new THREE.Vector3()
  const scratchQuaternion = new THREE.Quaternion()
  const centre = new THREE.Vector2(0, 0)
  const timer = new THREE.Timer()

  renderer.setAnimationLoop(() => {
    timer.update()
    const dt = Math.min(timer.getDelta(), 0.1)
    const t = timer.getElapsed()
    now = t

    const showProjects = view === 'projects'
    showWheel = view === 'wheel'
    showGrid = view === 'grid'
    const showCards = showProjects || showWheel || showGrid
    const insideBefore = inside
    inside = clamp(inside + (showCards ? dt : -dt) / 0.3, 0, 1)
    if (inside !== insideBefore) resize()
    const k = easeInOutCubic(inside)
    // the cards only grow in the arrangement the view asks for; switching between the ring
    // and the wheel shrinks them out first, then they come back in their new places
    const wantMode = view === 'wheel' ? 'wheel' : view === 'grid' ? 'grid' : 'ring'
    const growing = showCards && cardsMode === wantMode
    cardsTime = clamp(cardsTime + (growing ? dt : -dt * 4), 0, cardsDuration)
    if (cardsTime === 0 && cardsMode !== wantMode) {
      cardsMode = wantMode
      for (const card of cards) card.setShape(cardsMode === 'grid' ? 'flat' : cardsMode)
    }
    const onTheWheel = cardsMode === 'wheel'
    const onTheGrid = cardsMode === 'grid'
    wheel.update(dt)
    pan.update(dt)

    // the dome is always around the viewer, white with its grid, and the title always inked
    const uniforms = sphere.material.uniforms
    uniforms.uWhite.value = 1
    uniforms.uGrid.value = 1
    title.uniforms.uInk.value = 1
    const titleOpacity = 1
    title.uniforms.uOpacity.value = titleOpacity
    uniforms.uTime.value = t
    ringAmount = damp(ringAmount, showProjects ? 1 : 0, 6, dt)
    uniforms.uSectionAmount.value = k * ringAmount
    // pulse rings come from the viewer's side on the landing and from the top among the projects
    uniforms.uFacing.value.set(0, k, 1 - k).normalize()

    title.uniforms.uTime.value = t
    const brandScale = titleScale * (1 - k)
    brand.visible = titleOpacity > 0 && k < 0.999
    brand.position.y = Math.sin(t * 0.8) * 0.08
    brand.rotation.y = Math.sin(t * 0.5) * 0.06
    title.group.scale.set(brandScale, brandScale, 1)
    title.group.position.y = -0.6 * brandScale
    logo.group.scale.setScalar(0.55 * brandScale)
    logo.group.position.y = 0.4 * brandScale
    // turn slowly from side to side so the reflections travel across the steel
    logo.group.rotation.y = Math.sin(t * 0.6) * 0.35
    logo.material.opacity = titleOpacity

    look.update(t)

    if (!showCards) closeDetail()
    detailBlend = flight.update(detail !== null ? 1 : 0, dt, 11, 0.72)
    const open = detailBlend

    // Once the card has landed, the page shows its own copy of it in the same place (the one
    // that collapses as the text scrolls) and this one steps out until the card is closed.
    detailArrived = detail !== null && detailBlend === 1 ? detailArrived + dt : 0

    // An open card is not pinned rigidly to the screen: it keeps a share of the camera's lean
    // and shake, as if it hung in the dome a little way. `swayQuaternion` is that leftover
    // rotation in camera space. The page content shown with the card gets the very same
    // rotation about the eye as a CSS transform, so the two never drift apart.
    if (detailBlend !== 0) {
      const { yaw, pitch, roll } = look.sway
      swayEuler.set(-pitch * DETAIL_SWAY, -yaw * DETAIL_SWAY, -roll * DETAIL_SWAY, 'YXZ')
      swayQuaternion.setFromEuler(swayEuler)
      // eye distance in CSS pixels, i.e. the CSS perspective that matches the camera
      const eye = window.innerHeight / 2 / Math.tan(degToRad(visibleFov / 2))
      swayMatrix
        .makeTranslation(0, 0, eye)
        .multiply(swayShift.makeRotationFromQuaternion(swayQuaternion))
        .multiply(swayShift.makeTranslation(0, 0, -eye))
      // three's y axis points up, CSS's points down
      const m = swayMatrix.elements.map((value, i) => ((i % 4 === 1) !== (i >> 2 === 1) ? -value : value))
      onSway(`perspective(${eye.toFixed(1)}px) matrix3d(${m.map((value) => value.toFixed(6)).join(',')})`)
      swaying = true
    } else if (swaying) {
      swaying = false
      onSway('none')
    }

    let next: number | null = null
    cardRing.visible = cardsTime > 0
    // the rest of the wheel sinks away while one of its cards is open
    cardRing.position.y = onTheWheel ? -WHEEL_SINK * open : 0
    if (cardRing.visible) {
      if (detailBlend !== 0) {
        // the open card keeps the focus until it is back in its place
        next = detailCard
      } else if (showProjects || showGrid) {
        // the ring and the grid are aimed at with the lens at the centre of the screen
        camera.updateMatrixWorld()
        raycaster.setFromCamera(centre, camera)
        const hit = raycaster.intersectObjects(bodies, false)[0]
        if (hit) {
          next = bodies.indexOf(hit.object as (typeof bodies)[number])
          if (hit.uv) pressAt.set(hit.uv.x * 2 - 1, hit.uv.y * 2 - 1)
        }
      } else if (showWheel) {
        // the card at the front of the wheel is the chosen one
        next = wheel.selected
      }

      if (tapped && (showProjects || showGrid)) {
        if (detail !== null) {
          // the page folds the card's header back out first, then calls closeDetail
          onCloseRequest()
        } else if (detailBlend === 0 && next !== null) {
          detail = detailCard = next
          look.setPan(false)
          onDetail(next)
        } else if (detailBlend === 0) {
          onExit()
        }
      } else if (tapped && showWheel) {
        if (detail !== null) {
          onCloseRequest()
        } else if (detailBlend === 0) {
          camera.updateMatrixWorld()
          raycaster.setFromCamera(tapAt, camera)
          const hit = raycaster.intersectObjects(bodies, false)[0]
          const i = hit ? bodies.indexOf(hit.object as (typeof bodies)[number]) : -1
          if (i === wheel.selected) {
            detail = detailCard = i
            look.setPan(false)
            onDetail(i)
          } else if (i >= 0) {
            wheel.snapTo(i)
          } else {
            onExit()
          }
        }
      }

      cards.forEach((card, i) => {
        const chosen = focus[i].update(i === next ? 1 : 0, dt, 14, 0.55)
        // the card pops in, overshooting its size a little before settling
        const enter = easeOutBack(clamp((cardsTime - 0.1 - i * CARD_STAGGER) / CARD_ENTER, 0, 1))
        // on the grid the cards are drawn smaller, so more of them fit under the lens
        const scale = Math.max(enter, 0.001) * (1 + FOCUS_SCALE * chosen) * (onTheGrid ? GRID_CARD_SCALE : 1)
        const group = card.group
        if (onTheWheel) placeOnWheel(i)
        else if (onTheGrid) placeOnGrid(i)
        const homePosition = onTheWheel ? wheelPosition : onTheGrid ? gridPosition : homes[i].position
        const homeQuaternion = onTheWheel ? wheelQuaternion : onTheGrid ? gridQuaternion : homes[i].quaternion
        // on the wheel the cards not at the front stand back a little in the shade
        card.setDim(onTheWheel ? 1 - chosen : 0)
        // the card straightens out as it comes forward to be read
        card.setFlat(i === detailCard ? clamp(open, 0, 1) : 0)
        if (i === detailCard && open > 0) {
          // fly from its place to the spot in front of the camera, and stay glued to the camera there
          scratch.copy(detailPosition).applyQuaternion(swayQuaternion)
          const target = group.parent!.worldToLocal(camera.localToWorld(scratch))
          group.position.lerpVectors(homePosition, target, open)
          scratchQuaternion.copy(camera.quaternion).multiply(swayQuaternion)
          group.quaternion.slerpQuaternions(homeQuaternion, scratchQuaternion, open)
          group.scale.setScalar(scale + (1 - scale) * open)
          group.visible = detailArrived < 0.3
        } else {
          // in the ring the card gives way under the crosshair: whichever part is aimed at tips back
          const pressed = i === next && detailBlend === 0 && (showProjects || showGrid)
          const pressX = press[i].x.update(pressed ? pressAt.x : 0, dt, 12, 0.6)
          const pressY = press[i].y.update(pressed ? pressAt.y : 0, dt, 12, 0.6)
          pressTilt.setFromEuler(pressEuler.set(-pressY * PRESS_TILT, pressX * PRESS_TILT, 0))
          // shrunk to nothing behind an open card: not drawn at all
          group.visible = open < 1
          group.position.copy(homePosition)
          group.quaternion.copy(homeQuaternion).multiply(pressTilt)
          // the other cards step aside while one is open
          group.scale.setScalar(Math.max(scale * (1 - open), 0.001))
        }
        // offset each card so they don't all fade in step
        card.update(t - i * 0.7)
      })
    }
    tapped = false
    focused = next
    if (focused !== null) uniforms.uFocusU.value = sectionU(focused)
    // the dome lights up the chosen card's section, in the ring only
    uniforms.uFocus.value = damp(uniforms.uFocus.value, focused === null || cardsMode !== 'ring' ? 0 : 1, 6, dt)

    // the dome covers every pixel, so only the depth buffer needs clearing
    renderer.clearDepth()
    renderer.render(scene, camera)

    // the write-up's models pop in once its text has appeared, and out again with it
    const showInserts = detail !== null && detailArrived > 0.45
    const insertsVisible = insertsAmount.update(showInserts ? 1 : 0, dt, 8, 0.6)
    if (insertsVisible > 0.001) inserts.render(dt, insertsVisible)

    // the crosshair: a ring among the projects that turns to glass over a card, gone while one is open
    lensAmount = damp(lensAmount, (showProjects || showGrid) && detail === null ? 1 : 0, 9, dt)
    // on its own spring, so it also morphs back to the ring when the aim leaves a card
    lensGlass = glass.update(focused === null ? 0 : 1, dt, 12, 0.6)
    lens.render(renderer, scene, camera, lensAmount, lensGlass)
  })

  return {
    /** Send the open card back to its place in the ring. */
    closeDetail,
    /** A picture of card `i` exactly as the scene draws it, minus the photo. */
    cardImage: (i: number) => cards[i].image(),
    /** Where card `i`'s photo slideshow is, in seconds (see card.update). */
    photoTime: (i: number) => now - i * 0.7,
    /** The page's boxes for the open write-up's 3D models, and the text column that clips them. */
    setInserts(items: { element: HTMLElement; insert: Insert }[], list: HTMLElement) {
      inserts.set(items, list)
    },
    setView(next: View) {
      view = next
      // only the ring is looked around by panning; on the wheel and the grid the finger
      // moves the cards instead, and over the grid the view tips down to look at them
      look.setMode(view === 'projects' ? 'drag' : 'parallax')
      look.setBasePitch(view === 'grid' ? -Math.PI / 2 : 0)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onPress)
      canvas.removeEventListener('pointermove', onDrag)
      canvas.removeEventListener('pointerup', onRelease)
      canvas.removeEventListener('pointercancel', onRelease)
      canvas.removeEventListener('wheel', onWheel)
      look.dispose()
      title.dispose()
      logo.dispose()
      lens.dispose()
      inserts.dispose()
      environment.dispose()
      for (const card of cards) card.dispose()
      sphere.geometry.dispose()
      sphere.material.dispose()
      renderer.dispose()
    },
  }
}
