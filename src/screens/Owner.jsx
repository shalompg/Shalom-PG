import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import {
  Sun, Home, Users, Settings as Cog, Bell, Check, Search, LogOut, Wallet, Download, Upload,
  MessageCircle, Mail, ShieldCheck, PartyPopper, UserPlus, BellRing, CalendarDays, KeyRound,
} from 'lucide-react'
import {
  useDB, useSession, signOut, updateOwner, rentState, periodOf, today, exportOwner, importOwner, monthlyDue, changeOwnerPassword, cloud,
} from '../store'
import { inr, monthName, fmtDate, DEFAULT_TEMPLATE, buildMessage } from '../reminders'
import { Avatar, Chip, Field, Empty, AnimatedNumber, pageMotion, listParent, listItem, useToast, spring, ease } from '../ui'
import { go } from '../router'
import { Logo, APP_NAME } from './Auth'
import { Houses, HouseDetail } from './Houses'
import { TenantSheet, ReminderSheet, BulkRemindSheet, PaySheet, TenantFormSheet } from './TenantSheet'

const Ctx = createContext(null)
export const useOwner = () => useContext(Ctx)

const NAV = [
  ['today', 'Today', Sun],
  ['houses', 'Houses', Home],
  ['people', 'Residents', Users],
  ['settings', 'Settings', Cog],
]

export default function OwnerApp({ route }) {
  const db = useDB()
  const session = useSession()
  const owner = db.owners.find((o) => o.id === session.id)
  const view = route[0] === 'o' && route[1] ? route[1] : 'today'
  const toast = useToast()
  const [openId, setOpenId] = useState(null)
  const [remindId, setRemindId] = useState(null)
  const [payId, setPayId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(null)

  const data = useMemo(() => {
    if (!owner) return { houses: [], tenants: [], payments: [], states: {}, houseOf: {}, lastReminder: {} }
    const houses = db.houses.filter((h) => h.ownerId === owner.id)
    const tenants = db.tenants.filter((t) => t.ownerId === owner.id)
    const ids = new Set(tenants.map((t) => t.id))
    const payments = db.payments.filter((p) => ids.has(p.tenantId))
    const states = Object.fromEntries(tenants.map((t) => [t.id, rentState(t, payments, owner.remindDays ?? 3)]))
    const houseOf = Object.fromEntries(houses.map((h) => [h.id, h]))
    const lastReminder = {}
    for (const r of db.reminders) if (ids.has(r.tenantId) && (!lastReminder[r.tenantId] || r.at > lastReminder[r.tenantId].at)) lastReminder[r.tenantId] = r
    return { houses, tenants, payments, states, houseOf, lastReminder }
  }, [db, owner])

  // One gentle nudge per visit when something needs attention.
  const nudged = useRef(false)
  useEffect(() => {
    if (nudged.current) return
    nudged.current = true
    if (!owner) return
    const due = Object.values(data.states).filter((s) => s.status === 'today' || s.status === 'overdue').length
    if (due) {
      setTimeout(() => toast(`${due} rent${due > 1 ? 's' : ''} need${due > 1 ? '' : 's'} attention today`, { tone: 'warn' }), 700)
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(APP_NAME, { body: `${due} rent${due > 1 ? 's are' : ' is'} due or overdue today.` })
      }
    }
  }, [data, toast])

  if (!owner) return null
  const ctx = {
    owner, ...data,
    open: setOpenId,
    remind: setRemindId,
    bulkRemind: setBulk,
    pay: setPayId,
    addResident: () => setAdding(true),
  }

  const attention = Object.values(data.states).filter((s) => s.status === 'overdue' || s.status === 'today').length

  let page
  if (view === 'house' && route[2]) page = <HouseDetail key={'h' + route[2]} id={route[2]} />
  else if (view === 'houses') page = <Houses key="houses" />
  else if (view === 'people') page = <People key="people" />
  else if (view === 'settings') page = <Settings key="settings" />
  else page = <Today key="today" />

  const active = view === 'house' ? 'houses' : view
  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className="side">
          <Logo />
          <nav>
            {NAV.map(([k, label, Icon]) => (
              <button key={k} className={'side-link' + (active === k ? ' on' : '')} onClick={() => go('o/' + k)}>
                {active === k && <motion.span layoutId="side-pill" className="side-pill" transition={spring} />}
                <Icon size={18} />
                <span>{label}</span>
                {k === 'today' && attention > 0 && <b className="badge">{attention}</b>}
              </button>
            ))}
          </nav>
          <div className="side-me">
            <Avatar name={owner.name} size={36} />
            <div>
              <strong>{owner.name}</strong>
              <small>{owner.email}</small>
            </div>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </aside>

        <main className="main">
          <LayoutGroup>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={page.key} className="page" {...pageMotion}>
                {page}
              </motion.div>
            </AnimatePresence>
          </LayoutGroup>
        </main>

        <nav className="tabbar">
          {NAV.map(([k, label, Icon]) => (
            <button key={k} className={active === k ? 'on' : ''} onClick={() => go('o/' + k)}>
              {active === k && <motion.span layoutId="tab-pill" className="tab-pill" transition={spring} />}
              <span className="tab-ic">
                <Icon size={20} />
                {k === 'today' && attention > 0 && <b className="dot" />}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <TenantSheet id={openId} onClose={() => setOpenId(null)} />
      <ReminderSheet id={remindId} onClose={() => setRemindId(null)} />
      <PaySheet id={payId} onClose={() => setPayId(null)} />
      <TenantFormSheet open={adding} onClose={() => setAdding(false)} houseId={data.houses[0]?.id} />
      <BulkRemindSheet group={bulk} onClose={() => setBulk(null)} />
    </Ctx.Provider>
  )
}

/* ---------------- shared rows ---------------- */
const ORDER = { overdue: 0, today: 1, soon: 2, scheduled: 3, paid: 4, left: 5 }

export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 6e4)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function dueLine(s) {
  if (s.status === 'overdue') return `${-s.days} day${s.days === -1 ? '' : 's'} late${s.months > 1 ? ` · ${s.months} months` : ''}`
  if (s.status === 'today') return 'Due today'
  if (s.status === 'paid') return `Next due ${fmtDate(s.due)}`
  if (s.status === 'left') return 'Moved out'
  return `Due ${fmtDate(s.due)} · in ${s.days} day${s.days === 1 ? '' : 's'}`
}

export function RentRow({ t, showHouse = true }) {
  const { states, houseOf, open, remind, pay, lastReminder } = useOwner()
  const s = states[t.id]
  const h = houseOf[t.houseId]
  const r = lastReminder[t.id]
  const needs = s.status === 'overdue' || s.status === 'today' || s.status === 'soon'
  return (
    <motion.div layout variants={listItem} className={'row ' + s.status} onClick={() => open(t.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(t.id)}>
      <Avatar name={t.name} src={t.photo} size={46} />
      <div className="row-main">
        <strong>{t.name}</strong>
        <small>
          {showHouse && h ? h.name + ' · ' : ''}
          {t.room ? 'Room ' + t.room : 'No room yet'}
        </small>
        <small className={'row-due ' + s.status}>
          {dueLine(s)}
          {needs && r && <span className="reminded"> · Reminded {ago(r.at)}</span>}
        </small>
      </div>
      <div className="row-side">
        {t.active && (
          <>
            <span className="row-amt">{inr(needs ? s.amount : monthlyDue(t))}</span>
            {needs ? (
              <div className="row-actions">
                <button className="icon-btn soft" title="Send reminder" aria-label="Send reminder" onClick={(e) => { e.stopPropagation(); remind(t.id) }}>
                  <Bell size={16} />
                </button>
                <button className="icon-btn soft ok" title="Record payment" aria-label="Record payment" onClick={(e) => { e.stopPropagation(); pay(t.id) }}>
                  <Check size={16} />
                </button>
              </div>
            ) : (
              <Chip status={s.status} />
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}

/* ---------------- Today ---------------- */
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function Ring({ pct }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r={r} className="ring-bg" />
      <motion.circle cx="40" cy="40" r={r} className="ring-fg" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1.1, ease }} />
    </svg>
  )
}

function Today() {
  const { owner, tenants, states, payments, houses, bulkRemind, addResident } = useOwner()
  const cur = periodOf(today())
  const live = tenants.filter((t) => t.active)
  const billable = live.filter((t) => states[t.id].status !== 'scheduled' || states[t.id].period === cur)
  const expected = billable.reduce((a, t) => a + monthlyDue(t), 0)
  const collected = payments.filter((p) => p.period === cur).reduce((a, p) => a + p.amount, 0)
  const by = (st) => live.filter((t) => states[t.id].status === st)
  const overdue = by('overdue').sort((a, b) => states[a.id].days - states[b.id].days)
  const dueToday = by('today')
  const soon = by('soon').sort((a, b) => states[a.id].days - states[b.id].days)
  const recent = [...payments].sort((a, b) => b.at - a.at).slice(0, 5)
  const tById = Object.fromEntries(tenants.map((t) => [t.id, t]))
  const outstanding = [...overdue, ...dueToday].reduce((a, t) => a + states[t.id].amount, 0)

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="display">
            {greeting()}, <em>{owner.name.split(' ')[0]}</em>
          </h1>
        </div>
        {houses.length > 0 && (
          <button className="btn primary" onClick={addResident}>
            <UserPlus size={18} /> <span className="hide-sm">Add resident</span>
          </button>
        )}
      </header>

      <motion.section className="stats" variants={listParent} initial="initial" animate="animate">
        <motion.div variants={listItem} className="stat hero-stat">
          <div className="ring-wrap">
            <Ring pct={expected ? Math.min(1, collected / expected) : 0} />
            <span>{expected ? Math.round((collected / expected) * 100) : 0}%</span>
          </div>
          <div>
            <p className="stat-label">Collected in {monthName(cur, true)}</p>
            <p className="stat-big">
              <AnimatedNumber value={collected} format={inr} />
            </p>
            <p className="stat-sub">of {inr(expected)} expected</p>
          </div>
        </motion.div>
        <motion.div variants={listItem} className="stat tone-danger">
          <p className="stat-label">Overdue</p>
          <p className="stat-big"><AnimatedNumber value={overdue.length} /></p>
          <p className="stat-sub">{overdue.length ? inr(overdue.reduce((a, t) => a + states[t.id].amount, 0)) + ' pending' : 'Nobody late'}</p>
        </motion.div>
        <motion.div variants={listItem} className="stat tone-warn">
          <p className="stat-label">Due today</p>
          <p className="stat-big"><AnimatedNumber value={dueToday.length} /></p>
          <p className="stat-sub">{dueToday.length ? inr(dueToday.reduce((a, t) => a + monthlyDue(t), 0)) : 'Nothing today'}</p>
        </motion.div>
        <motion.div variants={listItem} className="stat">
          <p className="stat-label">Residents</p>
          <p className="stat-big"><AnimatedNumber value={live.length} /></p>
          <p className="stat-sub">across {houses.length} house{houses.length === 1 ? '' : 's'}</p>
        </motion.div>
      </motion.section>

      {houses.length === 0 && (
        <Empty
          icon={Home}
          title="Add your first house"
          action={<button className="btn primary" onClick={() => go('o/houses')}>Add a house</button>}
        >
          Start by adding each PG building. Then add the people staying there, with their photo and ID.
        </Empty>
      )}

      {live.length > 0 && <BulkBar live={live} states={states} onPick={bulkRemind} />}

      {houses.length > 0 && (
        <section className="block">
          <div className="block-head">
            <h2><BellRing size={18} /> Needs attention</h2>
            {outstanding > 0 && <span className="muted">{inr(outstanding)} to collect</span>}
          </div>
          {overdue.length + dueToday.length + soon.length === 0 ? (
            <Empty icon={PartyPopper} title="All caught up">
              No rent is due or late right now. Enjoy the quiet.
            </Empty>
          ) : (
            <motion.div className="list" variants={listParent} initial="initial" animate="animate">
              <AnimatePresence initial={false}>
                {overdue.length > 0 && <GroupLabel key="g1" tone="danger">Overdue</GroupLabel>}
                {overdue.map((t) => <RentRow key={t.id} t={t} />)}
                {dueToday.length > 0 && <GroupLabel key="g2" tone="warn">Due today</GroupLabel>}
                {dueToday.map((t) => <RentRow key={t.id} t={t} />)}
                {soon.length > 0 && <GroupLabel key="g3" tone="info">Coming up · next {owner.remindDays ?? 3} days</GroupLabel>}
                {soon.map((t) => <RentRow key={t.id} t={t} />)}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section className="block">
          <div className="block-head">
            <h2><Wallet size={18} /> Recently received</h2>
          </div>
          <div className="list compact">
            {recent.map((p) => {
              const t = tById[p.tenantId]
              if (!t) return null
              return (
                <div key={p.id} className="mini-row">
                  <Avatar name={t.name} src={t.photo} size={32} />
                  <span><strong>{t.name}</strong> · {monthName(p.period, true)} rent</span>
                  <span className="mini-amt">+{inr(p.amount)}</span>
                  <small>{fmtDate(p.paidOn)}</small>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}

export const GROUPS = [
  ['overdue', 'Overdue', 'danger', (s) => s.status === 'overdue'],
  ['today', 'Due today', 'warn', (s) => s.status === 'today'],
  ['tomorrow', 'Due tomorrow', 'info', (s) => ['soon', 'scheduled'].includes(s.status) && s.days === 1],
  ['week', 'Next 7 days', 'muted', (s) => ['soon', 'scheduled'].includes(s.status) && s.days >= 1 && s.days <= 7],
]
function BulkBar({ live, states, onPick }) {
  return (
    <section className="block">
      <div className="block-head">
        <h2><CalendarDays size={18} /> Remind in one go</h2>
      </div>
      <div className="bulk-grid">
        {GROUPS.map(([k, label, tone, test]) => {
          const ids = live.filter((t) => test(states[t.id])).map((t) => t.id)
          return (
            <motion.button
              key={k}
              whileTap={{ scale: 0.97 }}
              className={'bulk-btn ' + tone}
              disabled={!ids.length}
              onClick={() => onPick({ key: k, title: label, ids })}
            >
              <span className="bulk-n">{ids.length}</span>
              <span className="bulk-label">{label}</span>
              <Bell size={15} />
            </motion.button>
          )
        })}
      </div>
    </section>
  )
}

function GroupLabel({ children, tone }) {
  return (
    <motion.p layout variants={listItem} className={'group-label ' + tone}>
      <i /> {children}
    </motion.p>
  )
}

/* ---------------- Residents ---------------- */
const FILTERS = [
  ['all', 'All'],
  ['attention', 'Needs attention'],
  ['paid', 'Paid'],
  ['left', 'Moved out'],
]
function People() {
  const { tenants, states, houses, houseOf, addResident } = useOwner()
  const [q, setQ] = useState('')
  const [f, setF] = useState('all')
  const [house, setHouse] = useState('all')
  const list = tenants
    .filter((t) => (f === 'left' ? !t.active : t.active))
    .filter((t) => {
      const st = states[t.id].status
      if (f === 'attention') return ['overdue', 'today', 'soon'].includes(st)
      if (f === 'paid') return st === 'paid'
      return true
    })
    .filter((t) => house === 'all' || t.houseId === house)
    .filter((t) => {
      const s = q.trim().toLowerCase()
      return !s || [t.name, t.phone, t.room, t.email, houseOf[t.houseId]?.name].some((x) => String(x || '').toLowerCase().includes(s))
    })
    .sort((a, b) => ORDER[states[a.id].status] - ORDER[states[b.id].status] || a.name.localeCompare(b.name))

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Everyone</p>
          <h1 className="display">Residents</h1>
        </div>
        {houses.length > 0 && (
          <button className="btn primary" onClick={addResident}>
            <UserPlus size={18} /> <span className="hide-sm">Add resident</span>
          </button>
        )}
      </header>
      <div className="toolbar">
        <label className="search">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, room…" />
        </label>
        {houses.length > 1 && (
          <select className="select" value={house} onChange={(e) => setHouse(e.target.value)}>
            <option value="all">All houses</option>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
      </div>
      <div className="filters">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={'filter' + (f === k ? ' on' : '')} onClick={() => setF(k)}>
            {f === k && <motion.span layoutId="filter-pill" className="filter-pill" transition={spring} />}
            <span>{label}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={Users} title={tenants.length ? 'No one matches' : 'No residents yet'}>
          {tenants.length ? 'Try a different search or filter.' : 'Tap “Add resident” to add the first person.'}
        </Empty>
      ) : (
        <motion.div className="list" variants={listParent} initial="initial" animate="animate" key={f + house}>
          {list.map((t) => <RentRow key={t.id} t={t} />)}
        </motion.div>
      )}
    </>
  )
}

/* ---------------- Settings ---------------- */
function Settings() {
  const { owner, tenants, states, houseOf } = useOwner()
  const toast = useToast()
  const [form, setForm] = useState({
    name: owner.name, phone: owner.phone || '', payLink: owner.payLink || '', remindDays: owner.remindDays ?? 3, template: owner.template || DEFAULT_TEMPLATE,
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fileRef = useRef()
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))

  const sample = tenants.find((t) => t.active) || { name: 'Ananya Rao', rent: 9500, room: '101' }
  const sampleState = states[sample.id] || { status: 'today', period: periodOf(today()), due: today(), days: 0, months: 1, amount: sample.rent, unpaid: [] }
  const preview = buildMessage({ owner: { ...owner, ...form }, house: houseOf[sample.houseId] || { name: 'Lotus House' }, tenant: sample, state: sampleState })

  const save = (e) => {
    e.preventDefault()
    updateOwner(owner.id, { ...form, remindDays: Math.max(0, Math.min(10, Number(form.remindDays) || 0)), template: form.template.trim() === DEFAULT_TEMPLATE.trim() ? '' : form.template })
    toast('Settings saved', { tone: 'ok' })
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Your account</p>
          <h1 className="display">Settings</h1>
        </div>
      </header>

      <form className="settings" onSubmit={save}>
        <section className="card">
          <h2>Profile</h2>
          <div className="grid-2">
            <Field label="Your name" value={form.name} onChange={set('name')} required />
            <Field label="Phone" value={form.phone} onChange={set('phone')} type="tel" placeholder="98765 43210" />
          </div>
          <p className="muted small">Signed in as {owner.email}</p>
        </section>

        <section className="card">
          <h2>Getting paid</h2>
          <Field label="Payment link (optional)" value={form.payLink} onChange={set('payLink')} type="url" pattern="https://.*" title="Must start with https://" maxLength={300} placeholder="https://razorpay.me/@yourpg" hint="A Razorpay / PhonePe / Paytm payment page. This is what goes into WhatsApp and email reminders." />
        </section>

        <section className="card">
          <h2>Reminders</h2>
          <Field label="Start reminding this many days before the due date" type="number" min="0" max="10" value={form.remindDays} onChange={set('remindDays')} />
          <div className="grid-2 template-grid">
            <Field label="Message" hint="Placeholders: {first} {name} {house} {room} {amount} {month} {when} {pay} {owner}">
              <textarea rows={10} value={form.template} onChange={set('template')} />
            </Field>
            <div className="field">
              <span className="field-label">Preview</span>
              <div className="wa-preview">
                <div className="wa-bubble">{preview}</div>
              </div>
            </div>
          </div>
          <div className="row-inline">
            <div>
              <strong>Phone alerts</strong>
              <p className="muted small">Show a notification when you open {APP_NAME} and rent is due.</p>
            </div>
            {perm === 'granted' ? (
              <Chip status="paid">On</Chip>
            ) : perm === 'unsupported' ? (
              <Chip status="scheduled">Not supported</Chip>
            ) : (
              <button type="button" className="btn sm" onClick={async () => setPerm(await Notification.requestPermission())}>
                Turn on
              </button>
            )}
          </div>
        </section>

        <div className="save-bar">
          <button className="btn primary">Save changes</button>
        </div>
      </form>

      <PasswordCard />

      <section className="card">
        <h2>Your data</h2>
        <p className="muted small">
          <ShieldCheck size={14} /> Everything is private to your account. The backup file contains residents’ personal details, so keep it somewhere safe and don’t share it.
        </p>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => {
              const blob = new Blob([JSON.stringify(exportOwner(owner.id))], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `shalom-pg-backup-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
            }}
          >
            <Download size={16} /> Download backup
          </button>
          {!cloud && (
            <button className="btn" onClick={() => fileRef.current.click()}>
              <Upload size={16} /> Restore backup
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              try {
                importOwner(owner.id, JSON.parse(await e.target.files[0].text()))
                toast('Backup restored', { tone: 'ok' })
              } catch (x) {
                toast(x.message, { tone: 'danger' })
              }
              e.target.value = ''
            }}
          />
          <button className="btn ghost danger-text" onClick={signOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </section>
      <p className="credits muted small">
        <MessageCircle size={13} /> WhatsApp · <Mail size={13} /> Email reminders, sent in one tap.
      </p>
    </>
  )
}

function PasswordCard() {
  const toast = useToast()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault()
        if (pw !== pw2) return toast('The two passwords don’t match.', { tone: 'danger' })
        setBusy(true)
        try {
          await changeOwnerPassword(pw)
          setPw('')
          setPw2('')
          toast('Password changed', { tone: 'ok' })
        } catch (x) {
          toast(x.message, { tone: 'danger' })
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2><KeyRound size={18} /> Change password</h2>
      <div className="grid-2">
        <Field label="New password" type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <Field label="Repeat new password" type="password" minLength={6} required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </div>
    </form>
  )
}
