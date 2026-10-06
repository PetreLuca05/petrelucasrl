import * as THREE from 'three'

const DEPTH = 0.28
const CORNER = 0.14

const points = (flat: number[]) => {
  const out: THREE.Vector2[] = []
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]))
  return out
}

// The mark is a rounded square (-1..1) cut in two by a diagonal channel that swells into a
// ring around an almond-shaped island. These are the two banks of the channel and the island.
const upperBank = points([-0.86, -0.5, -0.47, -0.22, -0.31, 0.2, -0.2, 0.42, 0.03, 0.6, 0.4, 0.73, 0.62, 0.77])
const lowerBank = points([0.69, 0.52, 0.58, 0.16, 0.3, -0.14, -0.05, -0.25, -0.4, -0.4, -0.62, -0.7])
const island = points([
  0.63, 0.7, 0.4, 0.66, 0.1, 0.54, -0.13, 0.37, -0.18, 0.26, -0.03, 0.13, 0.28, 0.1, 0.5, 0.2, 0.6, 0.45,
])

/** The piece above and to the left of the channel. */
function upperShape() {
  const shape = new THREE.Shape()
  shape.moveTo(0.8, 1)
  shape.lineTo(-1 + CORNER, 1)
  shape.quadraticCurveTo(-1, 1, -1, 1 - CORNER)
  shape.lineTo(-1, -0.63)
  shape.splineThru(upperBank)
  shape.lineTo(0.8, 1)
  return shape
}

/** The piece below and to the right of the channel. */
function lowerShape() {
  const shape = new THREE.Shape()
  shape.moveTo(-0.84, -1)
  shape.lineTo(1 - CORNER, -1)
  shape.quadraticCurveTo(1, -1, 1, -1 + CORNER)
  shape.lineTo(1, 0.76)
  shape.splineThru(lowerBank)
  shape.lineTo(-0.84, -1)
  return shape
}

function islandShape() {
  const shape = new THREE.Shape()
  shape.moveTo(island[0].x, island[0].y)
  shape.splineThru([...island.slice(1), island[0]])
  return shape
}

/** The company mark as three bevelled slabs of brushed stainless steel, 2 units across. */
export function createLogo() {
  // needs scene.environment to have something to reflect
  const material = new THREE.MeshStandardMaterial({
    // a touch darker than bare steel so the mark holds its shape against the white dome
    color: 0xaab0b8,
    metalness: 1,
    roughness: 0.34,
    transparent: true,
  })
  const group = new THREE.Group()
  const geometries = [upperShape(), lowerShape(), islandShape()].map((shape) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH,
      curveSegments: 24,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.03,
      bevelSegments: 4,
    })
    geometry.translate(0, 0, -DEPTH / 2)
    group.add(new THREE.Mesh(geometry, material))
    return geometry
  })

  return {
    group,
    material,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      material.dispose()
    },
  }
}
