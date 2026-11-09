import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, ArrowLeft, Pencil, Trash2, UserPlus, MapPin, Users } from 'lucide-react'
import { addHouse, updateHouse, deleteHouse, periodOf, today, monthlyDue } from '../store'
import { inr } from '../reminders'
import { Field, Sheet, Empty, listParent, listItem, useToast, ease } from '../ui'
import { go } from '../router'
import { useOwner, RentRow } from './Owner'
import { TenantFormSheet } from './TenantSheet'
import { ImportButton } from './Import'

export function HouseArt({ hue, id, big }) {
  return (
    <motion.div layoutId={'art-' + id} className={'house-art' + (big ? ' big' : '')} style={{ '--h': hue }} transition={{ duration: 0.5, ease }}>
      <svg viewBox="0 0 120 62" aria-hidden="true">
        <path d="M22 62V34l20-16 20 16v28z" className="ha-a" />
        <path d="M56 62V26l24-18 24 18v36z" className="ha-b" />
        <rect x="31" y="40" width="7" height="7" rx="1" className="ha-win" />
        <rect x="45" y="40" width="7" height="7" rx="1" className="ha-win" />
        <rect x="66" y="32" width="8" height="8" rx="1" className="ha-win" />
        <rect x="86" y="32" width="8" height="8" rx="1" className="ha-win" />
        <rect x="66" y="46" width="8" height="8" rx="1" className="ha-win" />
        <rect x="86" y="46" width="8" height="8" rx="1" className="ha-win" />
        <rect x="76" y="50" width="6" height="12" rx="1" className="ha-door" />
        <circle cx="104" cy="14" r="6" className="ha-sun" />
      </svg>
    </motion.div>
  )
}

function houseNumbers(h, tenants, states, payments) {
  const cur = periodOf(today())
  const live = tenants.filter((t) => t.houseId === h.id && t.active)
  const ids = new Set(live.map((t) => t.id))
  const expected = live.reduce((a, t) => a + monthlyDue(t), 0)
  const collected = payments.filter((p) => ids.has(p.tenantId) && p.period === cur).reduce((a, p) => a + p.amount, 0)
  const late = live.filter((t) => states[t.id].status === 'overdue').length
  return { live, expected, collected, late }
}

export function Houses() {
  const { houses, tenants, states, payments } = useOwner()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Your properties</p>
          <h1 className="display">Houses</h1>
        </div>
        <div className="btn-row">
          {houses.length > 0 && <ImportButton className="btn" />}
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={18} /> <span className="hide-sm">Add house</span>
          </button>
        </div>
      </header>

      {houses.length === 0 ? (
        <Empty icon={MapPin} title="No houses yet" action={<button className="btn primary" onClick={() => setAdding(true)}><Plus size={18} /> Add your first house</button>}>
          Add each PG building — “Lotus House”, “Block B”, whatever you call them.
        </Empty>
      ) : (
        <motion.div className="house-grid" variants={listParent} initial="initial" animate="animate">
          {houses.map((h) => {
            const n = houseNumbers(h, tenants, states, payments)
            const pct = n.expected ? n.collected / n.expected : 0
            return (
              <motion.button key={h.id} variants={listItem} className="house-card" onClick={() => go('o/house/' + h.id)} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
                <HouseArt hue={h.hue} id={h.id} />
                <div className="house-card-body">
                  <motion.h3 layoutId={'name-' + h.id}>{h.name}</motion.h3>
                  <p className="muted small">{h.address || 'No address'}</p>
                  <div className="house-meta">
                    <span><Users size={14} /> {n.live.length} resident{n.live.length === 1 ? '' : 's'}</span>
                    {n.late > 0 && <span className="chip danger"><i />{n.late} late</span>}
                  </div>
                  <div className="bar">
                    <motion.span initial={{ width: 0 }} animate={{ width: pct * 100 + '%' }} transition={{ duration: 0.9, ease, delay: 0.2 }} />
                  </div>
                  <p className="small muted">
                    {inr(n.collected)} of {inr(n.expected)} this month
                  </p>
                </div>
              </motion.button>
            )
          })}
          <motion.button variants={listItem} className="house-card add" onClick={() => setAdding(true)} whileHover={{ y: -4 }}>
            <Plus size={26} />
            <span>Add a house</span>
          </motion.button>
        </motion.div>
      )}
      <HouseFormSheet open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function HouseFormSheet({ open, onClose, house }) {
  const { owner } = useOwner()
  const toast = useToast()
  return (
    <Sheet open={open} onClose={onClose} title={house ? 'Edit house' : 'Add a house'} size="sm">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          const f = Object.fromEntries(new FormData(e.currentTarget))
          if (house) updateHouse(house.id, { name: f.name.trim(), address: f.address.trim() })
          else {
            const h = addHouse(owner.id, f)
            toast(`${h.name} added`, { tone: 'ok' })
            go('o/house/' + h.id)
          }
          onClose()
        }}
      >
        <Field label="House name" name="name" required defaultValue={house?.name} placeholder="e.g. Lotus House" autoFocus />
        <Field label="Address" name="address" defaultValue={house?.address} placeholder="Street, area, city" />
        <button className="btn primary lg">{house ? 'Save' : 'Add house'}</button>
      </form>
    </Sheet>
  )
}

export function HouseDetail({ id }) {
  const { houses, tenants, states, payments } = useOwner()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const h = houses.find((x) => x.id === id)
  if (!h) {
    return (
      <Empty title="House not found" action={<button className="btn" onClick={() => go('o/houses')}>Back to houses</button>} />
    )
  }
  const n = houseNumbers(h, tenants, states, payments)
  const residents = tenants.filter((t) => t.houseId === h.id && t.active)
  const ORDER = { overdue: 0, today: 1, soon: 2, scheduled: 3, paid: 4 }
  residents.sort((a, b) => ORDER[states[a.id].status] - ORDER[states[b.id].status] || String(a.room).localeCompare(String(b.room), undefined, { numeric: true }))

  return (
    <>
      <button className="back" onClick={() => go('o/houses')}>
        <ArrowLeft size={18} /> Houses
      </button>
      <section className="house-hero">
        <HouseArt hue={h.hue} id={h.id} big />
        <div className="house-hero-body">
          <motion.h1 layoutId={'name-' + h.id} className="display">{h.name}</motion.h1>
          {h.address && <p className="muted"><MapPin size={14} /> {h.address}</p>}
          <div className="hero-nums">
            <div><strong>{n.live.length}</strong><small>Residents</small></div>
            <div><strong>{inr(n.expected)}</strong><small>Monthly rent</small></div>
            <div><strong>{inr(n.collected)}</strong><small>Collected</small></div>
          </div>
          <div className="btn-row">
            <button className="btn sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
            <button
              className="btn sm ghost danger-text"
              onClick={() => {
                try {
                  if (!confirm(`Delete ${h.name}? This can’t be undone.`)) return
                  deleteHouse(h.id)
                  go('o/houses')
                } catch (x) {
                  toast(x.message, { tone: 'danger' })
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2><Users size={18} /> Residents</h2>
          <div className="btn-row">
            <ImportButton houseId={h.id} />
            <button className="btn sm primary" onClick={() => setAdding(true)}><UserPlus size={14} /> Add resident</button>
          </div>
        </div>
        {residents.length === 0 ? (
          <Empty icon={Users} title="No one here yet">
            Add people one by one, or import everyone at once from an Excel sheet.
          </Empty>
        ) : (
          <motion.div className="list" variants={listParent} initial="initial" animate="animate">
            {residents.map((t) => <RentRow key={t.id} t={t} showHouse={false} />)}
          </motion.div>
        )}
      </section>

      <HouseFormSheet open={editing} onClose={() => setEditing(false)} house={h} />
      <TenantFormSheet open={adding} onClose={() => setAdding(false)} houseId={h.id} />
    </>
  )
}
