import * as THREE from 'three'
import { displayColor } from '../three/color.ts'
import type { Project } from './data.ts'

const FONT = '"Space Grotesk", system-ui, sans-serif'
const CANVAS_W = 1024
const CANVAS_H = 512
// the blurred photo behind each card's face: how much it is enlarged, how blurred (a mipmap
// level), how much colour it gains, and how far it is washed toward white (as in index.css)
const BACKDROP_ZOOM = 1.5
const BACKDROP_LOD = 4.5
const BACKDROP_SATURATION = 1.4
const BACKDROP_WASH = 0.5
// how far in from its edges the photo fades into the backdrop, as a share of its height
const PHOTO_EDGE = 0.3
// photo slot on the card canvas; the text column starts to its right
const PHOTO = { x: 32, y: 32, w: 384, h: 448 }
const TEXT_X = 456
const TEXT_W = CANVAS_W - TEXT_X - 40

// photos are scaled down to fit this many pixels on their longer side
const PHOTO_MAX_SIZE = 1024

export const HOLD_SECONDS = 3
export const FADE_SECONDS = 1.2

// Each card's slideshow goes through its photos in order: one is held for HOLD_SECONDS, then
// fades over FADE_SECONDS into the next. The sharp photo and the blurred backdrop behind it
// always show the same one, and the page's copy of an open card follows the same clock.
// Each card runs a little behind the one before (see SLIDE_OFFSET), so they change at
// different moments.
/** Seconds each card's slideshow runs behind the card before it. */
export const SLIDE_OFFSET = 1.3
/** Which photo a slideshow at `t` seconds shows: fading from `a` to `b` by `mix`. */
export function slideAt(count: number, t: number) {
  if (count < 2) return { a: 0, b: 0, mix: 0 }
  const cycle = HOLD_SECONDS + FADE_SECONDS
  const time = Math.max(t, 0)
  const step = Math.floor(time / cycle)
  return { a: step % count, b: (step + 1) % count, mix: THREE.MathUtils.smoothstep(time - step * cycle, HOLD_SECONDS, cycle) }
}

// run `work` when the browser has a quiet moment
const idle = (work: () => void) => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => work())
  else setTimeout(work, 300)
}

// how finely a card is tessellated, so it can bend smoothly
const SEGMENTS = 24
// how bright the back of a card is, as a share of its face (0 black)
const BACK_SHADE = 0.08
// how much a card that is not the chosen one is shaded on the wheel (0 none, 1 black)
const DIM = 0.18

/** The arrangement the cards are in: around the viewer, on the wheel in front, or flat on the grid. */
export type CardShape = 'ring' | 'wheel' | 'flat'

const photoVertex = /* glsl */ `
  #include <morphtarget_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    #include <begin_vertex>
    #include <morphtarget_vertex>
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`

/**
 * `flat` bent onto a cylinder of `radius`: in the ring around a vertical axis, so the card's
 * sides curve toward the viewer like the ring itself; on the wheel around a horizontal one,
 * so its top and bottom curve away like the wheel. The flat shape is kept as a morph target
 * so a card can straighten out as it opens.
 */
function bend(flat: THREE.PlaneGeometry, radius: number, shape: CardShape) {
  const geometry = flat.clone()
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    if (shape === 'ring') {
      const a = x / radius
      position.setXYZ(i, radius * Math.sin(a), y, radius * (1 - Math.cos(a)))
    } else {
      const a = y / radius
      position.setXYZ(i, x, radius * Math.sin(a), -radius * (1 - Math.cos(a)))
    }
  }
  geometry.morphAttributes.position = [flat.attributes.position.clone()]
  geometry.computeVertexNormals()
  return geometry
}

const photoFragment = /* glsl */ `
  uniform sampler2D uA;
  uniform sampler2D uB;
  uniform float uAspectA;
  uniform float uAspectB;
  uniform float uAspect;
  uniform float uMix;
  uniform float uDim;
  varying vec2 vUv;

  ${displayColor}

  // object-fit: cover
  vec2 cover(vec2 uv, float aspect) {
    vec2 s = aspect > uAspect ? vec2(uAspect / aspect, 1.0) : vec2(1.0, aspect / uAspect);
    return (uv - 0.5) * s + 0.5;
  }

  void main() {
    // the photo is on the face only; the back of the card is plain
    if (!gl_FrontFacing) discard;
    vec3 a = texture2D(uA, cover(vUv, uAspectA)).rgb;
    vec3 b = texture2D(uB, cover(vUv, uAspectB)).rgb;

    // rounded corners, and edges that melt into the blurred backdrop over PHOTO_EDGE of the
    // photo's height (the page's copy does the same, see .detail-photo in index.css)
    const float radius = 0.045;
    vec2 p = abs((vUv - 0.5) * vec2(uAspect, 1.0)) - (vec2(uAspect, 1.0) * 0.5 - radius);
    float d = length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) - radius;
    float alpha = 1.0 - smoothstep(-${PHOTO_EDGE.toFixed(3)}, 0.0, d);

    gl_FragColor = vec4(displayColor(mix(a, b, uMix) * uDim), alpha);
  }
`

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawCard(canvas: HTMLCanvasElement, project: Project, index: number) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  ctx.beginPath()
  ctx.roundRect(2, 2, CANVAS_W - 4, CANVAS_H - 4, 44)
  ctx.fillStyle = '#fff'
  ctx.fill()

  // the number in the bottom right corner (.detail-number in index.css matches it)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(17, 17, 17, 0.45)'
  ctx.font = `700 28px ${FONT}`
  ctx.letterSpacing = '8px'
  ctx.textAlign = 'right'
  ctx.fillText(String(index + 1).padStart(2, '0'), CANVAS_W - 32, CANVAS_H - 40)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'

  // name: shrink to fit one line, wrap to two if it would get too small
  ctx.fillStyle = '#111'
  let size = 68
  ctx.font = `700 ${size}px ${FONT}`
  while (size > 48 && ctx.measureText(project.name).width > TEXT_W) {
    size -= 4
    ctx.font = `700 ${size}px ${FONT}`
  }
  // the name starts at the top now the number has moved to the corner
  let y = 34
  for (const line of wrapText(ctx, project.name, TEXT_W).slice(0, 2)) {
    y += size * 1.08
    ctx.fillText(line, TEXT_X, y)
  }

  ctx.fillStyle = 'rgba(17, 17, 17, 0.62)'
  ctx.font = `700 38px ${FONT}`
  y += 22
  const lines = wrapText(ctx, project.description, TEXT_W)
  const room = Math.floor((CANVAS_H - 36 - y) / 50)
  if (lines.length > room) lines[room - 1] = `${lines[room - 1].replace(/[\s.,;:]+$/, '')}…`
  for (const line of lines.slice(0, room)) {
    y += 50
    ctx.fillText(line, TEXT_X, y)
  }
}

/**
 * One project card, `width` world units wide and half as tall: photo slideshow left, name and
 * description right. It is bent to the circle it sits on, with `radii` giving the ring's and
 * the wheel's; see setShape. Given the renderer, textures are uploaded to the GPU as soon as
 * they are ready rather than during the first frame that shows them.
 */
export function createCard(
  project: Project,
  index: number,
  width: number,
  radii: Record<'ring' | 'wheel', number>,
  renderer?: THREE.WebGLRenderer,
) {
  const height = width / 2
  const group = new THREE.Group()

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  drawCard(canvas, project, index)
  const cardTexture = new THREE.CanvasTexture(canvas)
  cardTexture.colorSpace = THREE.SRGBColorSpace
  cardTexture.anisotropy = 8

  let disposed = false
  // the card's face as an image for the page, made in idle time so opening a card never waits for it
  let image = ''
  const makeImage = () => (image ||= canvas.toDataURL())
  idle(() => disposed || makeImage())
  document.fonts.load('700 68px "Space Grotesk"').then(() => {
    if (disposed) return
    drawCard(canvas, project, index)
    cardTexture.needsUpdate = true
    image = ''
    idle(() => disposed || makeImage())
    renderer?.initTexture(cardTexture)
  })

  // the card and its photo, flat and bent for each arrangement; the photo's place on the
  // card is built into its geometry so the two bend as one surface
  const photoW = (width * PHOTO.w) / CANVAS_W
  const photoH = (height * PHOTO.h) / CANVAS_H
  const bodyFlat = new THREE.PlaneGeometry(width, height, SEGMENTS, SEGMENTS / 2)
  const photoFlat = new THREE.PlaneGeometry(photoW, photoH, SEGMENTS / 2, SEGMENTS / 2)
  photoFlat.translate(((PHOTO.x + PHOTO.w / 2) / CANVAS_W - 0.5) * width, (0.5 - (PHOTO.y + PHOTO.h / 2) / CANVAS_H) * height, 0)
  const shapes: Record<CardShape, { body: THREE.BufferGeometry; photo: THREE.BufferGeometry }> = {
    ring: { body: bend(bodyFlat, radii.ring, 'ring'), photo: bend(photoFlat, radii.ring, 'ring') },
    wheel: { body: bend(bodyFlat, radii.wheel, 'wheel'), photo: bend(photoFlat, radii.wheel, 'wheel') },
    // as good as flat: bent to a circle far too large to notice, so it has the same morph target
    flat: { body: bend(bodyFlat, 1e6, 'ring'), photo: bend(photoFlat, 1e6, 'ring') },
  }

  // both sides are drawn, so the cards on the far side of the wheel show their backs, which
  // are near-black (the face's picture only shows through faintly)
  const bodyMaterial = new THREE.MeshBasicMaterial({ map: cardTexture, alphaTest: 0.5, side: THREE.DoubleSide })
  // Like iOS fills the space around a picture, the card's white face is its photo again,
  // enlarged, blurred and washed out, with the card's text multiplied over it. The blur comes
  // from the photo's smaller mipmap levels, so it costs a few texture reads.
  bodyMaterial.onBeforeCompile = (shader) => {
    // the backdrop shows the same photos as the face, read from the photo's own uniforms
    const u = photoMaterial.uniforms
    Object.assign(shader.uniforms, { uA: u.uA, uB: u.uB, uAspectA: u.uAspectA, uAspectB: u.uAspectB, uMix: u.uMix })
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uAspectA;
uniform float uAspectB;
uniform float uMix;
// object-fit: cover over the whole card, enlarged
vec2 backdropUv(vec2 uv, float aspect) {
  const float card = ${(CANVAS_W / CANVAS_H).toFixed(4)};
  vec2 s = aspect > card ? vec2(card / aspect, 1.0) : vec2(1.0, aspect / card);
  return (uv - 0.5) * s / ${BACKDROP_ZOOM.toFixed(2)} + 0.5;
}
vec3 blurred(sampler2D photo, vec2 uv) {
  // five reads of a small mipmap level, spread a little, smooth out its blockiness
  const float lod = ${BACKDROP_LOD.toFixed(1)};
  const float d = 0.02;
  vec3 c = textureLod(photo, uv, lod).rgb * 2.0;
  c += textureLod(photo, uv + vec2(d, 0.0), lod).rgb + textureLod(photo, uv - vec2(d, 0.0), lod).rgb;
  c += textureLod(photo, uv + vec2(0.0, d), lod).rgb + textureLod(photo, uv - vec2(0.0, d), lod).rgb;
  return sRGBTransferEOTF(vec4(c / 6.0, 1.0)).rgb;
}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
      if (gl_FrontFacing) {
        vec3 photo = mix(blurred(uA, backdropUv(vMapUv, uAspectA)), blurred(uB, backdropUv(vMapUv, uAspectB)), uMix);
        // a touch more colour, as a blur greys things out, then washed out toward white
        photo = mix(vec3(dot(photo, vec3(0.2126, 0.7152, 0.0722))), photo, ${BACKDROP_SATURATION.toFixed(2)});
        diffuseColor.rgb *= mix(photo, vec3(1.0), ${BACKDROP_WASH.toFixed(2)});
      } else {
        diffuseColor.rgb *= ${BACK_SHADE.toFixed(3)};
      }`,
      )
  }
  const body = new THREE.Mesh(shapes.ring.body, bodyMaterial)
  body.updateMorphTargets()
  group.add(body)

  // photos; `aspect` is filled in once each image has loaded
  const blank = new THREE.DataTexture(new Uint8Array([214, 216, 220, 255]), 1, 1)
  blank.needsUpdate = true
  const photos = project.photos.map((url) => {
    const photo = { texture: blank as THREE.Texture, aspect: 1 }
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (disposed) return
      // Draw the image onto a canvas of known size and upload that. Handing the image
      // itself to WebGL is unreliable on iOS Safari (SVGs in particular can land in one
      // corner of a black texture), and this also caps how much memory a large photo takes.
      const width = image.naturalWidth || 768
      const height = image.naturalHeight || 896
      const scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      const texture = new THREE.CanvasTexture(canvas)
      texture.anisotropy = 8
      renderer?.initTexture(texture)
      photo.texture = texture
      photo.aspect = canvas.width / canvas.height
    }
    image.src = url
    return photo
  })
  if (!photos.length) photos.push({ texture: blank, aspect: 1 })

  const photoMaterial = new THREE.ShaderMaterial({
    vertexShader: photoVertex,
    fragmentShader: photoFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uA: { value: blank as THREE.Texture },
      uB: { value: blank as THREE.Texture },
      uAspectA: { value: 1 },
      uAspectB: { value: 1 },
      uAspect: { value: photoW / photoH },
      uMix: { value: 0 },
      uDim: { value: 1 },
    },
  })
  const photoMesh = new THREE.Mesh(shapes.ring.photo, photoMaterial)
  // a hair in front of the card's face
  photoMesh.position.z = 0.004
  photoMesh.updateMorphTargets()
  photoMesh.renderOrder = 1
  group.add(photoMesh)

  return {
    group,
    body,
    /** The card as drawn (everything but the photo), 1024x512, as an image URL. */
    image: makeImage,
    /** `t` in seconds; cross-fades to the next photo every HOLD + FADE seconds. */
    update(t: number) {
      const slide = slideAt(photos.length, t)
      const a = photos[slide.a]
      const b = photos[slide.b]
      const u = photoMaterial.uniforms
      u.uA.value = a.texture
      u.uB.value = b.texture
      u.uAspectA.value = a.aspect
      u.uAspectB.value = b.aspect
      u.uMix.value = slide.mix
    },
    /** Darken the card, 0 not at all to 1 fully, for the ones that are not chosen. */
    setDim(amount: number) {
      const level = 1 - DIM * amount
      body.material.color.setScalar(level)
      photoMaterial.uniforms.uDim.value = level
    },
    /** Bend the card to the ring or the wheel, or lay it flat. Only call while the card is out of sight. */
    setShape(shape: CardShape) {
      body.geometry = shapes[shape].body
      photoMesh.geometry = shapes[shape].photo
      body.updateMorphTargets()
      photoMesh.updateMorphTargets()
    },
    /** Straighten the card out, 0 bent to 1 flat, as it comes forward to be read. */
    setFlat(amount: number) {
      body.morphTargetInfluences![0] = amount
      photoMesh.morphTargetInfluences![0] = amount
    },
    dispose() {
      disposed = true
      bodyFlat.dispose()
      photoFlat.dispose()
      for (const shape of Object.values(shapes)) {
        shape.body.dispose()
        shape.photo.dispose()
      }
      body.material.dispose()
      cardTexture.dispose()
      photoMaterial.dispose()
      blank.dispose()
      for (const photo of photos) photo.texture.dispose()
    },
  }
}
