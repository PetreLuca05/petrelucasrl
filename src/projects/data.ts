import type { UnityMaterialName } from '../toon/unity.ts'

/** A 3D model set into a project's write-up, with the text flowing around it. */
export type Insert = {
  /** URL of a .glb file. */
  model: string
  /** The paragraph it sits beside: the model's box comes just before paragraph `before` (0-based; not 0, which keeps its drop cap). */
  before: number
  side: 'left' | 'right'
  /**
   * Name of an animation clip in the file to play, if it has any. Given several, the model
   * wanders between them at random, blending smoothly from one to the next.
   */
  animation?: string | string[]
  /** Sway gently from side to side about its starting turn. */
  spin?: boolean
  /** Starting turn, in radians, for a model that looks better from an angle. */
  turn?: number
  /**
   * Which Unity toon material each of the file's materials stands for, by name. Every model is
   * toon shaded; a material left out is given two tones taken from its own colour.
   */
  toon?: Record<string, UnityMaterialName>
}

export type Project = {
  name: string
  description: string
  /** Image URLs; the card fades through them in order. */
  photos: string[]
  /** Paragraphs of the scrolling write-up shown when the card is opened. */
  details: string[]
  /** 3D models set into the write-up. */
  inserts?: Insert[]
}

// The first project's assets live in assets/p1. Each is named in full so the build copies
// only these files (a pattern would sweep up the .blend sources and the rest of the folder).
// The game's screenshots; the calculator picture in the folder is left out on purpose.
const p1Photos = [
  new URL('../../assets/p1/ewqewqewqetfsdwqad.PNG', import.meta.url).href,
  new URL('../../assets/p1/ewewewewe.PNG', import.meta.url).href,
  new URL('../../assets/p1/rererere.PNG', import.meta.url).href,
  new URL('../../assets/p1/ewewewereertewrwr.PNG', import.meta.url).href,
]
const p1Inserts: Insert[] = [
  { model: new URL('../../assets/p1/playermodell.glb', import.meta.url).href, before: 1, side: 'right', animation: 'Player|Idle', spin: true, turn: 0.6 - Math.PI + Math.PI / 2 - (25 * Math.PI) / 180, toon: { Body: 'Style3', Eyes: 'Eyes 1' } },
  { model: new URL('../../assets/p1/Car.glb', import.meta.url).href, before: 3, side: 'left', spin: true, turn: 0.8 },
  { model: new URL('../../assets/p1/Calculator.glb', import.meta.url).href, before: 5, side: 'right', spin: true },
  { model: new URL('../../assets/p1/Pencil.glb', import.meta.url).href, before: 7, side: 'left', spin: true, turn: 0.4 },
]

/** Stand-in artwork until real photos are added. */
function placeholder(label: string, shade: number) {
  const top = 225 - shade * 40
  const bottom = 150 - shade * 40
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="896" viewBox="0 0 768 896">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(${top},${top + 2},${top + 6})"/>
      <stop offset="1" stop-color="rgb(${bottom},${bottom + 4},${bottom + 12})"/>
    </linearGradient></defs>
    <rect width="768" height="896" fill="url(#g)"/>
    <g fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="3">
      <circle cx="384" cy="400" r="${190 + shade * 30}"/>
      <ellipse cx="384" cy="400" rx="${(190 + shade * 30) * 0.45}" ry="${190 + shade * 30}"/>
      <ellipse cx="384" cy="400" rx="${190 + shade * 30}" ry="${(190 + shade * 30) * 0.4}"/>
    </g>
    <text x="384" y="800" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700"
      font-size="64" letter-spacing="12" fill="#111" fill-opacity="0.7">${label}</text>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const placeholders = (n: number) => [0, 1, 2].map((i) => placeholder(`${String(n).padStart(2, '0')} · ${'ABC'[i]}`, i))

// Sample write-up, one paragraph per entry, shared by every project until the real text is written.
const sampleDetails = [
  'This is sample text standing in for the project write-up. It is here to show how a long piece of writing sits under the card, how it scrolls, and how the card folds away above it as you read. Replace every paragraph with the real story of the project.',
  'Start with the problem. Describe who came to us, what they were struggling with, and why the tools they already had were not enough. A reader who knows nothing about the client should understand what was at stake by the end of this paragraph.',
  'Then describe the first idea, including why it was not the one that shipped. The dead ends are often the most interesting part of a project, and they show how the final approach was earned rather than guessed.',
  'Explain the constraint that shaped everything else. It might have been a deadline, a budget, a slow device, an old system that could not be replaced, or a rule the client could not bend. Say how it changed the plan.',
  'Walk through the approach we settled on. Name the tools and technologies that carried the work, but keep the focus on the decisions: what was built first, what was left out on purpose, and what was tested before anything else.',
  'Point out the detail we are most proud of. It could be a small interaction that feels right, a screen that loads instantly, or a piece of engineering nobody will ever see. Describe it well enough that the reader can picture it.',
  'Be honest about the hardest part. Mention the bug that took days to find, the assumption that turned out to be wrong, or the feature that had to be rebuilt after the first round of feedback. Say what it taught us.',
  'Give the results in numbers where possible. How much faster, how many users, how much time or money saved. One clear figure is worth more than a paragraph of adjectives, and a quote from the client is worth more still.',
  'Close with where the project stands today and what comes next. If it is live, say where to find it. If it is still growing, say what the next version will add.',
  'All of these paragraphs live in src/projects/data.ts. Each project has its own details list, so every card can tell a different story once the sample text is replaced.',
]

// Placeholder content: replace names, descriptions, photos and details with the real projects.
export const projects: Project[] = [
  { name: 'Project One', description: 'A short description of the first project goes here.', photos: p1Photos, details: sampleDetails, inserts: p1Inserts },
  { name: 'Project Two', description: 'A short description of the second project goes here.', photos: placeholders(2), details: sampleDetails },
  { name: 'Project Three', description: 'A short description of the third project goes here.', photos: placeholders(3), details: sampleDetails },
  { name: 'Project Four', description: 'A short description of the fourth project goes here.', photos: placeholders(4), details: sampleDetails },
  { name: 'Project Five', description: 'A short description of the fifth project goes here.', photos: placeholders(5), details: sampleDetails },
  { name: 'Project Six', description: 'A short description of the sixth project goes here.', photos: placeholders(6), details: sampleDetails },
  { name: 'Project Seven', description: 'A short description of the seventh project goes here.', photos: placeholders(7), details: sampleDetails },
  { name: 'Project Eight', description: 'A short description of the eighth project goes here.', photos: placeholders(8), details: sampleDetails },
  { name: 'Project Nine', description: 'A short description of the ninth project goes here.', photos: placeholders(9), details: sampleDetails },
  { name: 'Project Ten', description: 'A short description of the tenth project goes here.', photos: placeholders(10), details: sampleDetails },
  { name: 'Project Eleven', description: 'A short description of the eleventh project goes here.', photos: placeholders(11), details: sampleDetails },
  { name: 'Project Twelve', description: 'A short description of the twelfth project goes here.', photos: placeholders(12), details: sampleDetails },
]
