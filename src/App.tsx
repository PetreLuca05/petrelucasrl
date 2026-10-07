import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent } from 'react'
import { slideAt } from './projects/card.ts'
import { projects } from './projects/data.ts'
import { createScroller } from './projects/scroller.ts'
import { createScene } from './scene.ts'
import type { View } from './scene.ts'
import { requestMotionPermission } from './three/look.ts'
import { setPageColor } from './three/viewport.ts'

// The address tracks where you are: '' is the landing, '#wheel' or '#grid' the cards and
// '#wheel/2' an open card. Each step is a history entry, so the browser's back button goes
// from an open card to the cards, and from the cards to the landing.
const OPEN_CARD = /^#(wheel|grid)\/\d+$/

// A load always starts from the landing, whatever the address says. Otherwise a reload (or
// the browser restoring the tab) in the projects would play the whole entrance by itself,
// title and all, with no tap to let the page ask for the motion sensors on the way.
if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export default function App() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  const view: View = hash.startsWith('#wheel') ? 'wheel' : hash.startsWith('#grid') ? 'grid' : 'landing'

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<ReturnType<typeof createScene> | null>(null)
  // the opened project; `shown` keeps its text on screen while it fades out
  const [detail, setDetail] = useState<number | null>(null)
  const [shown, setShown] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<ReturnType<typeof createScroller> | null>(null)
  // moves the collapsing header for the current card; swapped whenever a card opens
  const reportRef = useRef((_y: number) => {})
  const screenRef = useRef<HTMLDivElement>(null)
  const projectsRef = useRef<HTMLDivElement>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const [photo, setPhoto] = useState(0)
  // a picture of the 3D card, laid over the page's copy so the hand-over between them is exact
  const [cardImage, setCardImage] = useState('')
  // each photo's width over its height, learnt as it loads, for the collapsed header
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [closing, setClosing] = useState(false)
  const closeRef = useRef(() => {})

  // Closing mirrors opening. The header is folded back out to the full card first (by
  // gliding the text back to the top), so the page's copy matches the 3D card again when the
  // 3D card takes over and flies home.
  useEffect(() => {
    closeRef.current = () => {
      const scene = sceneRef.current
      const scroller = scrollerRef.current
      if (!scene || !scroller || detail === null || closing) return
      if (scroller.y <= 1) return scene.closeDetail()
      setClosing(true)
      scroller.scrollTo(0, () => {
        setClosing(false)
        scene.closeDetail()
      })
    }
  })

  // The write-up is scrolled by script, not by a native scroller (see projects/scroller.ts):
  // on iOS a native scroll switches the gyroscope off for as long as it lasts.
  useEffect(() => {
    const scroller = createScroller(listRef.current!, scrollRef.current!, (y) => reportRef.current(y))
    scrollerRef.current = scroller
    return () => scroller.dispose()
  }, [])

  // one scene for the whole site; changing view never rebuilds it
  useEffect(() => {
    const scene = createScene(
      canvasRef.current!,
      projects,
      (index) => {
        setDetail(index)
        if (index !== null) {
          setShown(index)
          setCardImage(sceneRef.current?.cardImage(index) ?? '')
          const base = window.location.hash.replace(/\/\d+$/, '').slice(1) || 'wheel'
          window.location.hash = `${base}/${index + 1}`
        } else if (OPEN_CARD.test(window.location.hash)) {
          // closed by a tap: step back so the history matches what is on screen
          history.back()
        }
      },
      () => {
        // leaving the projects: step back to the landing we came from, where there is one
        if (history.state?.fromLanding) history.back()
        else window.location.hash = ''
      },
      () => closeRef.current(),
      // every frame while a card is open; written straight to the element, not through React
      (transform) => {
        if (floatRef.current) floatRef.current.style.transform = transform
      },
    )
    sceneRef.current = scene
    return () => scene.dispose()
  }, [])

  useEffect(() => {
    sceneRef.current?.setView(view)
  }, [view])

  // going back from an open card's address closes the card
  useEffect(() => {
    if (!OPEN_CARD.test(hash)) closeRef.current()
  }, [hash])

  useEffect(() => {
    // Safari tints its bars to match the white dome
    setPageColor('#f6f6f4')
  }, [])

  const toggle = () => {
    // every tap, in either view, is a chance to ask for the motion sensors
    requestMotionPermission()
  }

  // 'wheel' is the wheel of cards (Projects 1), 'grid' the grid (Projects 2)
  const openProjects = (e: MouseEvent, target: 'wheel' | 'grid') => {
    e.stopPropagation()
    requestMotionPermission()
    window.location.hash = target
    // mark the entry, so leaving the projects steps back to the landing instead of adding
    // another entry; otherwise a back swipe on the landing would jump into the projects
    history.replaceState({ fromLanding: true }, '', `#${target}`)
  }

  // Scrolling the text works like a collapsing header. First the "Projects" label scrolls
  // away and the card rises with it; then the card loses height. CSS does the moving and
  // resizing from these variables: pixels risen and lost, and each one's progress from 0 to 1.
  // The scroller reports its position in the same frame it moves the text, so the header
  // never lags behind.
  useEffect(() => {
    const screen = screenRef.current!
    const style = getComputedStyle(screen)
    const riseRoom = parseFloat(style.getPropertyValue('--detail-rise-room')) || 1
    const room = parseFloat(style.getPropertyValue('--detail-collapse')) || 1
    // The variables go on the projects controls, so a change restyles only them, and nothing
    // is written while the header is already fully collapsed, which is most of the reading.
    const ui = projectsRef.current!
    let last = NaN
    reportRef.current = (y) => {
      const away = Math.min(Math.max(y, 0), riseRoom + room + 20)
      if (away === last) return
      last = away
      const rise = Math.min(away, riseRoom)
      const lost = Math.min(Math.max(away - riseRoom, 0), room)
      ui.style.setProperty('--detail-away', `${away}px`)
      ui.style.setProperty('--detail-rise', `${rise}px`)
      ui.style.setProperty('--detail-rise-progress', String(rise / riseRoom))
      ui.style.setProperty('--detail-lost', `${lost}px`)
      ui.style.setProperty('--detail-progress', String(lost / room))
    }
    // one wheel step takes the header from the full card straight to its mini strip, and back
    scrollerRef.current?.setSnap(riseRoom + room)
    scrollerRef.current?.reset()
  }, [shown, detail])

  // hand the scene the boxes for this project's models, in the order they appear on the page
  useEffect(() => {
    const scene = sceneRef.current
    const list = listRef.current
    if (!scene || !list) return
    const { details, inserts = [] } = projects[shown]
    const ordered = details.flatMap((_, i) => inserts.filter((insert) => insert.before === i))
    const elements = [...list.querySelectorAll<HTMLElement>('.detail-model')]
    scene.setInserts(
      elements.map((element, i) => ({ element, insert: ordered[i] })),
      list,
    )
  }, [shown])

  // The page's copy of the card follows the 3D card's slideshow (see slideAt), so the same
  // photo, and the same blurred backdrop, show on both when one takes over from the other.
  // Each image fades in and out by CSS as it becomes the current one.
  useEffect(() => {
    const follow = () => {
      const slide = slideAt(projects[shown].photos.length, sceneRef.current?.photoTime(shown) ?? 0)
      setPhoto(slide.mix > 0 ? slide.b : slide.a)
    }
    follow()
    const id = setInterval(follow, 100)
    return () => clearInterval(id)
  }, [shown])

  return (
    <div
      ref={screenRef}
      className={`screen ${view}${detail !== null ? ' detail' : ''}${closing ? ' closing' : ''}`}
      onClick={toggle}
    >
      <canvas ref={canvasRef} className="layer" />

      <div className="landing-ui">
        <div className="pills">
          <button className="pill" onClick={(e) => openProjects(e, 'wheel')}>
            Projects 1
          </button>
          <button className="pill" onClick={(e) => openProjects(e, 'grid')}>
            Projects 2
          </button>
        </div>
      </div>

      <div ref={projectsRef} className="projects-ui">
        <div className="projects-top">
          <span className="projects-title">{view === 'grid' ? 'Projects 2' : 'Projects 1'}</span>
        </div>
        {/* the open card and its text lean and shake with the camera (see onSway) */}
        <div ref={floatRef} className="detail-float">
        <div className="detail-head">
          <div className="detail-card">
            {cardImage && <img className="detail-card-image" src={cardImage} alt="" />}
            {/* the photo again, enlarged and blurred behind the collapsed header */}
            <div className="detail-backdrop">
              {projects[shown].photos.map((src, i) => (
                <img key={i} src={src} alt="" className={i === photo ? 'on' : ''} />
              ))}
            </div>
            <div
              className="detail-photo"
              style={{ '--photo-aspect': aspects[projects[shown].photos[photo]] } as React.CSSProperties}
            >
              {projects[shown].photos.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className={i === photo ? 'on' : ''}
                  onLoad={(e) => {
                    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
                    if (w && h) setAspects((known) => (known[src] ? known : { ...known, [src]: w / h }))
                  }}
                />
              ))}
            </div>
            <span className="detail-number">{String(shown + 1).padStart(2, '0')}</span>
            <div className="detail-text">
              <h2>{projects[shown].name}</h2>
              <p>{projects[shown].description}</p>
            </div>
          </div>
        </div>
        <div ref={listRef} className="detail-list">
          {/* the scroller slides this column up and down inside the list */}
          <div ref={scrollRef} className="detail-scroll">
            {/* Empty space the height of each scroll phase, so the first row starts under the
                full-size card and follows it up: first the rise, then the collapse. */}
            <div className="detail-header-space">
              <div className="detail-rise-space" />
              <div className="detail-collapse-space" />
            </div>
            {projects[shown].details.map((text, i) => (
              <Fragment key={i}>
                {/* empty boxes the text flows around; the scene draws a 3D model behind each */}
                {(projects[shown].inserts ?? [])
                  .filter((insert) => insert.before === i)
                  .map((insert, j) => (
                    <div key={j} className={`detail-model ${insert.side}`} />
                  ))}
                <p>{text}</p>
              </Fragment>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
