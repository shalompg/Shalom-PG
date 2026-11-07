import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { X, Camera, FileText, Upload, RefreshCw } from 'lucide-react'

export const ease = [0.28, 0.11, 0.32, 1] // Apple-style ease-out
export const spring = { type: 'spring', stiffness: 380, damping: 34 }

export const pageMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.42, ease } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18 } },
}
export const listParent = { animate: { transition: { staggerChildren: 0.045 } } }
export const listItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease } },
}

export function useMedia(q) {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const f = () => setM(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [q])
  return m
}

/* ---------- avatar ---------- */
export function hueFor(s = '') {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
export function Avatar({ name = '', src, size = 44, className = '' }) {
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
  return (
    <div className={'avatar ' + className} style={{ width: size, height: size, fontSize: size * 0.36, '--h': hueFor(name) }}>
      {src ? <img src={src} alt="" /> : initials}
    </div>
  )
}

/* ---------- status chip ---------- */
const STATUS = {
  overdue: ['Overdue', 'danger'],
  today: ['Due today', 'warn'],
  soon: ['Due soon', 'info'],
  paid: ['Paid', 'ok'],
  scheduled: ['Upcoming', 'muted'],
  pending: ['Awaiting approval', 'violet'],
  left: ['Moved out', 'muted'],
}
export function Chip({ status, children }) {
  const [label, tone] = STATUS[status] || [status, 'muted']
  return (
    <span className={'chip ' + tone}>
      <i />
      {children || label}
    </span>
  )
}

/* ---------- sheet (bottom sheet on phones, side panel on desktop) ---------- */
export function Sheet({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  const desktop = useMedia('(min-width: 900px)')
  const drag = useDragControls()
  useEffect(() => {
    if (!open) return
    const k = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', k)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const from = desktop ? { x: '104%' } : { y: '100%' }
  const to = desktop ? { x: 0 } : { y: 0 }
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className={`sheet sheet-${size}`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={from}
            animate={to}
            exit={from}
            transition={{ type: 'spring', damping: 36, stiffness: 360 }}
            drag={desktop ? false : 'y'}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, i) => (i.offset.y > 110 || i.velocity.y > 600) && onClose()}
          >
            <div className="sheet-top" onPointerDown={(e) => drag.start(e)}>
              <div className="grab" />
              <div className="sheet-head">
                <div>
                  <h3>{title}</h3>
                  {subtitle && <p>{subtitle}</p>}
                </div>
                <button className="icon-btn" onClick={onClose} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="sheet-body">{children}</div>
            {footer && <div className="sheet-foot">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {})
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random()
    setItems((x) => [...x.slice(-2), { id, msg, ...opts }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), opts.ms || 3600)
  }, [])
  const dismiss = (id) => setItems((x) => x.filter((t) => t.id !== id))
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              layout
              key={t.id}
              className={'toast ' + (t.tone || '')}
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
              transition={spring}
            >
              <span>{t.msg}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action.run()
                    dismiss(t.id)
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/* ---------- form bits ---------- */
export function Field({ label, hint, children, className = '', ...input }) {
  return (
    <label className={'field ' + className}>
      <span className="field-label">{label}</span>
      {children || <input {...input} />}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Segmented({ value, onChange, options, id }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} type="button">
          {value === v && <motion.span layoutId={'seg-' + id} className="seg-pill" transition={spring} />}
          <span className="seg-label">{label}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- files ---------- */
function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}
const safeName = (n) => String(n || 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 80)

/**
 * Only two kinds of upload are allowed:
 *  • images: re-drawn on a canvas and saved as JPEG (this also strips hidden metadata such as GPS location)
 *  • PDFs: checked by their real file signature ("%PDF-"), not just the name or reported type
 * Anything else (web pages, scripts, Office files…) is refused.
 */
export async function fileToData(file, max = 1280, quality = 0.78) {
  if (file.size > 8e6) throw new Error('That file is too large. Please use one under 8 MB.')
  if (!file.type.startsWith('image/')) {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    const isPdf = String.fromCharCode(...head) === '%PDF-'
    if (!isPdf) throw new Error('Please upload a photo or a PDF.')
    if (file.size > 4.5e6) throw new Error('That PDF is over 4.5 MB. Please upload a photo of the ID instead.')
    const data = await readAsDataURL(new Blob([file], { type: 'application/pdf' }))
    return { name: safeName(file.name), type: 'application/pdf', data }
  }
  const url = URL.createObjectURL(file)
  const img = await new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('Couldn’t read that image.'))
    i.src = url
  })
  const s = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * s)
  c.height = Math.round(img.height * s)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(url)
  return { name: safeName(file.name).replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', data: c.toDataURL('image/jpeg', quality) }
}

export function PhotoPick({ value, onChange, name }) {
  const ref = useRef()
  const toast = useToast()
  return (
    <div className="photo-pick">
      <button type="button" className="photo-pick-btn" onClick={() => ref.current.click()} aria-label="Upload photo">
        <Avatar name={name || '?'} src={value} size={84} />
        <span className="photo-pick-badge">
          <Camera size={14} />
        </span>
      </button>
      <div>
        <strong>Profile photo</strong>
        <small>A clear photo of the face. Opens the camera on phones.</small>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={async (e) => {
          const f = e.target.files[0]
          e.target.value = ''
          if (!f) return
          try {
            onChange((await fileToData(f, 520, 0.8)).data)
          } catch (err) {
            toast(err.message, { tone: 'danger' })
          }
        }}
      />
    </div>
  )
}

export function DocPick({ value, onChange, label = 'ID proof' }) {
  const ref = useRef()
  const toast = useToast()
  const [over, setOver] = useState(false)
  const take = async (f) => {
    if (!f) return
    try {
      onChange(await fileToData(f))
    } catch (err) {
      toast(err.message, { tone: 'danger' })
    }
  }
  return (
    <div
      className={'doc-pick' + (over ? ' over' : '') + (value ? ' has' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files[0])
      }}
      onClick={() => ref.current.click()}
      role="button"
      tabIndex={0}
    >
      {value ? (
        <>
          {value.type.startsWith('image/') ? <img src={value.data} alt="" /> : <div className="doc-icon"><FileText size={26} /></div>}
          <div className="doc-meta">
            <strong>{label} attached</strong>
            <small>{value.name}</small>
          </div>
          <span className="doc-replace">
            <RefreshCw size={14} /> Replace
          </span>
        </>
      ) : (
        <>
          <div className="doc-icon">
            <Upload size={22} />
          </div>
          <div className="doc-meta">
            <strong>Upload {label}</strong>
            <small>Photo or PDF · Aadhaar, PAN, passport, licence</small>
          </div>
        </>
      )}
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" hidden onChange={(e) => { take(e.target.files[0]); e.target.value = '' }} />
    </div>
  )
}

/* ---------- misc ---------- */
export function Empty({ icon: Icon, title, children, action }) {
  return (
    <motion.div className="empty" {...pageMotion}>
      {Icon && (
        <div className="empty-icon">
          <Icon size={26} />
        </div>
      )}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </motion.div>
  )
}

/** Full-screen photo viewer. Images only: PDFs open in the browser's own PDF viewer (see openDoc). */
export function Lightbox({ src, onClose }) {
  return createPortal(
    <AnimatePresence>
      {src && (
        <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.img src={src} alt="" initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} transition={spring} />
          <button className="icon-btn lb-close" aria-label="Close">
            <X size={20} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function AnimatedNumber({ value, format = (n) => n }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 700)
      const e = 1 - Math.pow(1 - k, 3)
      setShown(Math.round(a + (value - a) * e))
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(shown)}</>
}
