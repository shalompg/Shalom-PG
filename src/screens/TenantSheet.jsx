import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Phone, MessageCircle, Mail, Bell, Check, FileText, Pencil, LogOut, ShieldCheck, Copy, Undo2, X, Send, Wallet, Trash2,
} from 'lucide-react'
import {
  addTenant, updateTenant, deleteTenant, moveOut, markPaid, undoPayment, logReminder, periodOf, today, isoDay, monthlyDue,
} from '../store'
import { inr, monthName, fmtDate, ordinal, buildMessage, whatsappUrl, mailUrl, subjectFor, waNumber } from '../reminders'
import { Sheet, Avatar, Chip, Field, PhotoPick, DocPick, Lightbox, Segmented, useToast, listParent, listItem } from '../ui'
import { useOwner, ago } from './Owner'

export const ID_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Driving licence', 'Voter ID', 'College / office ID', 'Other']

export async function openDoc(doc, setLightbox) {
  if (!doc) return
  if (doc.type?.startsWith('image/')) return setLightbox({ src: doc.data, type: doc.type })
  // Always re-label the bytes as a PDF so the browser shows its PDF viewer and never runs it as a page.
  const bytes = await (await fetch(doc.data)).arrayBuffer()
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/* ---------------- resident detail ---------------- */
export function TenantSheet({ id, onClose }) {
  const { tenants, states, houseOf, payments, remind, pay, lastReminder } = useOwner()
  const toast = useToast()
  const [lightbox, setLightbox] = useState(null)
  const [editing, setEditing] = useState(false)
  const t = tenants.find((x) => x.id === id)
  const live = t && states[t.id]
  // Remember the last resident + rent state so the sheet can animate closed even after they're deleted.
  const [keep, setKeep] = useState(null)
  useEffect(() => { if (t && live) setKeep({ t, s: live }) }, [t, live])
  const tt = t || keep?.t
  const s = live || keep?.s
  const h = tt && houseOf[tt.houseId]

  // Month-by-month history since move-in (latest first, last 12).
  const history = []
  if (tt && tt.active) {
    const mine = payments.filter((p) => p.tenantId === tt.id)
    const start = new Date(tt.joinedOn + 'T00:00:00')
    const cur = periodOf(today())
    let y = start.getFullYear(), m = start.getMonth()
    while (true) {
      const p = `${y}-${String(m + 1).padStart(2, '0')}`
      if (p > cur) break
      history.unshift({ period: p, pay: mine.find((x) => x.period === p), late: s.unpaid.includes(p) })
      m++
      if (m > 11) { m = 0; y++ }
    }
  }
  const needs = s && ['overdue', 'today', 'soon'].includes(s.status)
  const r = tt && lastReminder[tt.id]

  return (
    <>
      <Sheet open={!!t} onClose={onClose} title="Resident" size="lg"
        footer={tt && (tt.active ? (
          <>
            <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} /> Edit details</button>
            <button className="btn ghost danger-text" onClick={() => {
              if (confirm(`Mark ${tt.name} as moved out? Their records stay in “Moved out”.`)) { moveOut(tt.id); onClose(); toast(`${tt.name} moved out`) }
            }}><LogOut size={15} /> Move out</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => {
              try {
                updateTenant(tt.id, { active: true, movedOutOn: null })
                toast(`${tt.name} moved back in`)
              } catch (x) {
                toast(x.message + ' Edit their details first.', { tone: 'danger' })
              }
            }}>Move back in</button>
            <button className="btn ghost danger-text" onClick={async () => {
              if (!confirm(`Permanently delete ${tt.name}? Their details, photo, ID document and payment history will be erased. This can’t be undone.`)) return
              try {
                await deleteTenant(tt.id)
                onClose()
                toast(`${tt.name}’s data was erased`)
              } catch (x) {
                toast(x.message, { tone: 'danger' })
              }
            }}><Trash2 size={15} /> Delete permanently</button>
          </>
        ))}
      >
        {tt && (
          <motion.div variants={listParent} initial="initial" animate="animate" className="tenant">
            <motion.div variants={listItem} className="tenant-hero">
              <button className="tenant-photo" onClick={() => tt.photo && setLightbox({ src: tt.photo, type: 'image/jpeg' })} aria-label="View photo">
                <Avatar name={tt.name} src={tt.photo} size={92} />
              </button>
              <div>
                <h2>{tt.name}</h2>
                <p className="muted">{h?.name}{tt.room ? ` · Room ${tt.room}` : ''}</p>
                <Chip status={s.status} />
              </div>
            </motion.div>

            <motion.div variants={listItem} className="quick">
              <a href={`tel:${tt.phone}`} className="quick-btn"><Phone size={18} /><span>Call</span></a>
              <a href={`https://wa.me/${waNumber(tt.phone)}`} target="_blank" rel="noreferrer" className="quick-btn wa"><MessageCircle size={18} /><span>WhatsApp</span></a>
              <a href={tt.email ? `mailto:${tt.email}` : undefined} className={'quick-btn' + (tt.email ? '' : ' off')}><Mail size={18} /><span>Email</span></a>
              {tt.active && <button className="quick-btn" onClick={() => remind(tt.id)}><Bell size={18} /><span>Remind</span></button>}
            </motion.div>

            {tt.active && (
              <motion.div variants={listItem} className={'rent-card ' + s.status}>
                <div>
                  <p className="stat-label">{needs ? (s.status === 'overdue' ? 'Overdue' : 'Due') : 'Rent'}</p>
                  <p className="rent-amt">{inr(needs ? s.amount : monthlyDue(tt))}</p>
                  <p className="small">
                    {s.status === 'overdue' && `Since ${fmtDate(s.due)} · ${-s.days} days late${s.months > 1 ? ` · ${s.months} months` : ''}`}
                    {s.status === 'today' && 'Due today'}
                    {s.status === 'soon' && `Due ${fmtDate(s.due, { weekday: 'short', day: 'numeric', month: 'short' })}`}
                    {s.status === 'paid' && `${monthName(periodOf(today()), true)} paid · next due ${fmtDate(s.due)}`}
                    {s.status === 'scheduled' && `Next due ${fmtDate(s.due)}`}
                  </p>
                  {r && <p className="small muted">Last reminded {ago(r.at)} via {r.channel}</p>}
                </div>
                {needs && (
                  <div className="rent-card-actions">
                    <button className="btn" onClick={() => remind(tt.id)}><Bell size={15} /> Remind</button>
                    <button className="btn primary" onClick={() => pay(tt.id)}><Wallet size={15} /> Record payment</button>
                  </div>
                )}
              </motion.div>
            )}

            <motion.div variants={listItem} className="info-grid">
              <Info label="Phone" value={tt.phone} />
              <Info label="Email" value={tt.email} />
              <Info label="Monthly rent" value={inr(tt.rent)} />
              <Info label="Due date" value={`${ordinal(tt.dueDay)} of every month`} />
              <Info label="Deposit" value={tt.deposit ? inr(tt.deposit) : '—'} />
              <Info label="Maintenance" value={tt.maintenance ? `${inr(tt.maintenance)} ${tt.maintenanceMonthly ? 'every month' : 'one-time'}` : '—'} />
              <Info label="Moved in" value={tt.joinedOn ? fmtDate(tt.joinedOn, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
              <Info label="Occupation" value={tt.occupation} />
              <Info label="Reminders via" value={{ whatsapp: 'WhatsApp', email: 'Email', both: 'WhatsApp + Email' }[tt.channel]} />
              <Info label="Emergency contact" value={tt.emergencyName ? `${tt.emergencyName}${tt.emergencyPhone ? ' · ' + tt.emergencyPhone : ''}` : ''} wide />
              {tt.notes && <Info label="Notes" value={tt.notes} wide />}
            </motion.div>

            <motion.div variants={listItem}>
              <h4 className="sub-head"><ShieldCheck size={16} /> Documents</h4>
              <div className="docs">
                <button className="doc-tile" onClick={() => tt.photo && setLightbox({ src: tt.photo, type: 'image/jpeg' })} disabled={!tt.photo}>
                  {tt.photo ? <img src={tt.photo} alt="" /> : <span className="doc-missing"><X size={18} /></span>}
                  <span><strong>Photo</strong><small>{tt.photo ? 'Tap to view' : 'Not uploaded'}</small></span>
                </button>
                <button className="doc-tile" onClick={() => openDoc(tt.idDoc, setLightbox)} disabled={!tt.idDoc}>
                  {tt.idDoc ? (tt.idDoc.type.startsWith('image/') ? <img src={tt.idDoc.data} alt="" /> : <span className="doc-pdf"><FileText size={20} /></span>) : <span className="doc-missing"><X size={18} /></span>}
                  <span><strong>{tt.idType || 'ID proof'}</strong><small>{tt.idDoc ? 'Tap to view' : 'Not uploaded'}</small></span>
                </button>
              </div>
            </motion.div>

            {history.length > 0 && (
              <motion.div variants={listItem}>
                <h4 className="sub-head">Payment history</h4>
                <div className="history">
                  {history.slice(0, 12).map(({ period, pay, late }) => (
                    <div key={period} className={'hist ' + (pay ? 'paid' : late ? 'late' : 'open')}>
                      <span className="hist-dot">{pay ? <Check size={13} /> : null}</span>
                      <div>
                        <strong>{monthName(period)}</strong>
                        <small>{pay ? `${inr(pay.amount)} · ${pay.method} · ${fmtDate(pay.paidOn)}` : late ? 'Not paid' : 'Not due yet'}</small>
                      </div>
                      {pay ? (
                        <button className="btn xs ghost" onClick={() => { undoPayment(pay.id); toast(`${monthName(period, true)} marked unpaid`) }}><Undo2 size={13} /> Undo</button>
                      ) : (
                        <button className="btn xs" onClick={() => { markPaid(tt.id, period, monthlyDue(tt)); toast(`${monthName(period, true)} marked paid`, { tone: 'ok' }) }}><Check size={13} /> Paid</button>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </Sheet>
      <Lightbox src={lightbox?.src} type={lightbox?.type} onClose={() => setLightbox(null)} />
      {tt && <TenantFormSheet open={editing} onClose={() => setEditing(false)} tenant={tt} houseId={tt.houseId} />}
    </>
  )
}

function Info({ label, value, wide }) {
  return (
    <div className={'info' + (wide ? ' wide' : '')}>
      <small>{label}</small>
      <span>{value || '—'}</span>
    </div>
  )
}

/* ---------------- add / edit resident ---------------- */
export function TenantFormSheet({ open, onClose, tenant, houseId }) {
  const { owner, houses } = useOwner()
  const toast = useToast()
  const blank = { name: '', phone: '', email: '', room: '', rent: '', deposit: '', maintenance: '', maintenanceMonthly: false, dueDay: 5, joinedOn: isoDay(new Date()), occupation: '', emergencyName: '', emergencyPhone: '', idType: 'Aadhaar', channel: 'whatsapp', notes: '', photo: '', idDoc: null, houseId }
  const [f, setF] = useState(blank)
  useEffect(() => { if (open) setF(tenant ? { ...blank, ...tenant } : blank) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))

  const submit = (e) => {
    e.preventDefault()
    try {
      if (tenant) {
        const { id, ...rest } = f // eslint-disable-line no-unused-vars
        updateTenant(tenant.id, rest)
        toast('Details saved', { tone: 'ok' })
      } else {
        addTenant(owner.id, f.houseId, f)
        toast(`${f.name} added`, { tone: 'ok' })
      }
      onClose()
    } catch (x) {
      toast(x.message, { tone: 'danger' })
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={tenant ? 'Edit resident' : 'Add a resident'} subtitle={tenant ? tenant.name : 'Fields marked * are required.'} size="lg">
      <form className="stack" onSubmit={submit}>
        <PhotoPick value={f.photo} onChange={set('photo')} name={f.name} />
        <div className="grid-2">
          <Field label="Full name *" value={f.name} onChange={set('name')} required />
          <Field label="Mobile *" type="tel" value={f.phone} onChange={set('phone')} required placeholder="98765 43210" />
          <Field label="Email (optional)" type="email" value={f.email} onChange={set('email')} placeholder="For email reminders" />
          <Field label="Occupation" value={f.occupation} onChange={set('occupation')} placeholder="Student, engineer…" />
        </div>
        <h4 className="sub-head">Stay</h4>
        <div className="grid-3">
          <Field label="House">
            <select value={f.houseId} onChange={set('houseId')}>
              {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
          <Field label="Room / bed" value={f.room} onChange={set('room')} placeholder="101-A" />
          <Field label="Moved in *" type="date" value={f.joinedOn} onChange={set('joinedOn')} required />
          <Field label="Monthly rent (₹) *" type="number" min="1" value={f.rent} onChange={set('rent')} required />
          <Field label="Rent due on (day) *" type="number" min="1" max="30" value={f.dueDay} onChange={set('dueDay')} required hint="1–30. In shorter months, the last day." />
          <Field label="Security deposit (₹) *" type="number" min="0" value={f.deposit} onChange={set('deposit')} required hint="Refundable. Enter 0 if none." />
          <Field label="Maintenance (₹)" type="number" min="0" value={f.maintenance} onChange={set('maintenance')} placeholder="0" />
          <Field label="Maintenance is charged">
            <select value={f.maintenanceMonthly ? 'monthly' : 'once'} onChange={(e) => setF((x) => ({ ...x, maintenanceMonthly: e.target.value === 'monthly' }))}>
              <option value="once">One-time</option>
              <option value="monthly">Every month, with rent</option>
            </select>
          </Field>
        </div>
        {f.maintenanceMonthly && Number(f.maintenance) > 0 && (
          <p className="hint-box">Each month’s total due: {inr((Number(f.rent) || 0) + (Number(f.maintenance) || 0))} (rent + maintenance)</p>
        )}
        <h4 className="sub-head">ID & safety</h4>
        <div className="grid-2">
          <Field label="ID type">
            <select value={f.idType} onChange={set('idType')}>{ID_TYPES.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
          <Field label="Send reminders on">
            <select value={f.channel} onChange={set('channel')}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="both">Both</option>
            </select>
          </Field>
        </div>
        <DocPick value={f.idDoc} onChange={set('idDoc')} label="ID proof" />
        <div className="grid-2">
          <Field label="Emergency contact name *" value={f.emergencyName} onChange={set('emergencyName')} required />
          <Field label="Emergency contact phone *" type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} required />
        </div>
        <Field label="Notes (only you see these)">
          <textarea rows={2} value={f.notes} onChange={set('notes')} />
        </Field>
        <button className="btn primary lg">{tenant ? 'Save changes' : 'Add resident'}</button>
      </form>
    </Sheet>
  )
}

/* ---------------- reminder composer ---------------- */
export function ReminderSheet({ id, onClose }) {
  const { owner, tenants, states, houseOf } = useOwner()
  const toast = useToast()
  const t = tenants.find((x) => x.id === id)
  const [text, setText] = useState('')
  useEffect(() => {
    if (t) setText(buildMessage({ owner, house: houseOf[t.houseId], tenant: t, state: states[t.id] }))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = (channel) => {
    const s = states[t.id]
    if (channel === 'whatsapp') window.open(whatsappUrl(t.phone, text), '_blank')
    if (channel === 'email') location.href = mailUrl(t.email, subjectFor(houseOf[t.houseId], s), text)
    if (channel === 'copy') navigator.clipboard.writeText(text)
    logReminder(t.id, s.period, channel === 'copy' ? 'copied text' : channel === 'whatsapp' ? 'WhatsApp' : 'email')
    toast(channel === 'copy' ? 'Message copied' : `Reminder opened in ${channel === 'whatsapp' ? 'WhatsApp' : 'your email app'}`, { tone: 'ok' })
    if (channel !== 'copy') onClose()
  }

  return (
    <Sheet open={!!t} onClose={onClose} title="Send a reminder" subtitle={t && `${t.name} · ${inr(states[t.id].amount || monthlyDue(t))}`} size="md">
      {t && (
        <div className="stack">
          <div className="wa-preview edit">
            <textarea className="wa-bubble" value={text} onChange={(e) => setText(e.target.value)} rows={11} aria-label="Message" />
          </div>
          {!owner.payLink && (
            <p className="hint-box">Tip: add a payment link in Settings to include it in reminders. Your UPI ID is never put in messages.</p>
          )}
          <div className="send-grid">
            <button className="btn wa lg" onClick={() => send('whatsapp')}><MessageCircle size={18} /> WhatsApp</button>
            <button className="btn lg" onClick={() => send('email')} disabled={!t.email} title={t.email ? '' : 'No email on file'}><Mail size={18} /> Email</button>
            <button className="btn ghost" onClick={() => send('copy')}><Copy size={16} /> Copy text</button>
          </div>
          <p className="muted small center">WhatsApp opens with the message ready — just press send.</p>
        </div>
      )}
    </Sheet>
  )
}

/* ---------------- remind a whole group ---------------- */
export function BulkRemindSheet({ group, onClose }) {
  const { owner, tenants, states, houseOf } = useOwner()
  const toast = useToast()
  const [sent, setSent] = useState({})
  useEffect(() => { if (group) setSent({}) }, [group])
  const list = (group?.ids || []).map((id) => tenants.find((t) => t.id === id)).filter(Boolean)
  const msg = (t) => buildMessage({ owner, house: houseOf[t.houseId], tenant: t, state: states[t.id] })
  const send = (t, channel) => {
    const st = states[t.id]
    if (channel === 'whatsapp') window.open(whatsappUrl(t.phone, msg(t)), '_blank')
    else location.href = mailUrl(t.email, subjectFor(houseOf[t.houseId], st), msg(t))
    logReminder(t.id, st.period, channel === 'whatsapp' ? 'WhatsApp' : 'email')
    setSent((x) => ({ ...x, [t.id]: channel }))
  }
  const next = list.find((t) => !sent[t.id])
  const done = list.length - list.filter((t) => !sent[t.id]).length
  const prefer = (t) => (t.channel === 'email' && t.email ? 'email' : 'whatsapp')

  return (
    <Sheet open={!!group} onClose={onClose} title={group ? `Remind: ${group.title.toLowerCase()}` : ''} subtitle={group && `${list.length} resident${list.length === 1 ? '' : 's'} · ${inr(list.reduce((a, t) => a + (states[t.id].amount || t.rent), 0))} in total`} size="md"
      footer={group && (
        next ? (
          <button className="btn wa lg grow" onClick={() => send(next, prefer(next))}>
            <Send size={17} /> Send to {next.name.split(' ')[0]} ({done + 1} of {list.length})
          </button>
        ) : (
          <button className="btn primary lg grow" onClick={() => { toast(`${list.length} reminder${list.length === 1 ? '' : 's'} sent`, { tone: 'ok' }); onClose() }}>
            <Check size={17} /> All {list.length} sent. Done
          </button>
        )
      )}
    >
      {group && (
        <div className="stack">
          <div className="bulk-progress"><motion.i animate={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} /></div>
          <p className="muted small">Each tap opens WhatsApp (or email) with that person’s own message ready. Press send there, then come back for the next one.</p>
          <motion.div className="list" variants={listParent} initial="initial" animate="animate">
            {list.map((t) => {
              const st = states[t.id]
              const did = sent[t.id]
              return (
                <motion.div key={t.id} variants={listItem} className={'row bulk-row' + (did ? ' done' : '')}>
                  <Avatar name={t.name} src={t.photo} size={40} />
                  <div className="row-main">
                    <strong>{t.name}</strong>
                    <small>{inr(st.amount || monthlyDue(t))} · {houseOf[t.houseId]?.name}{t.room ? ` · ${t.room}` : ''}</small>
                    {did && <small className="row-due paid">Sent on {did === 'whatsapp' ? 'WhatsApp' : 'email'}</small>}
                  </div>
                  <div className="row-actions">
                    <button className="icon-btn soft wa" title="WhatsApp" aria-label={`WhatsApp ${t.name}`} onClick={() => send(t, 'whatsapp')}><MessageCircle size={16} /></button>
                    <button className="icon-btn soft" title="Email" aria-label={`Email ${t.name}`} disabled={!t.email} onClick={() => send(t, 'email')}><Mail size={16} /></button>
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      )}
    </Sheet>
  )
}

/* ---------------- record a payment ---------------- */
const METHODS = [['UPI', 'UPI'], ['Cash', 'Cash'], ['Bank transfer', 'Bank']]
export function PaySheet({ id, onClose }) {
  const { tenants, states } = useOwner()
  const toast = useToast()
  const t = tenants.find((x) => x.id === id)
  const st = t && states[t.id]
  // Unpaid months first; if nothing is unpaid, the next month (paying in advance).
  const options = st ? (st.unpaid.length ? st.unpaid : [st.period]) : []
  const [sel, setSel] = useState([])
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('UPI')
  const [date, setDate] = useState(isoDay(new Date()))
  useEffect(() => {
    if (!t) return
    setSel(options)
    setAmount(String(options.length * monthlyDue(t)))
    setMethod('UPI')
    setDate(isoDay(new Date()))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p) => {
    const next = sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p].sort()
    setSel(next)
    setAmount(String(next.length * monthlyDue(t)))
  }
  const submit = (e) => {
    e.preventDefault()
    if (!sel.length) return toast('Pick at least one month.', { tone: 'danger' })
    const total = Number(amount) || 0
    const per = Math.round(total / sel.length)
    const made = sel.map((p) => markPaid(t.id, p, per, method, date))
    toast(`${inr(total)} from ${t.name.split(' ')[0]} recorded`, {
      tone: 'ok',
      action: { label: 'Undo', run: () => made.forEach((p) => undoPayment(p.id)) },
    })
    onClose()
  }

  return (
    <Sheet open={!!t} onClose={onClose} title="Record payment" subtitle={t && `${t.name} · ${inr(monthlyDue(t))} a month`} size="sm">
      {t && (
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <span className="field-label">For which month{options.length > 1 ? 's' : ''}?</span>
            <div className="month-chips">
              {options.map((p) => (
                <button type="button" key={p} className={'month-chip' + (sel.includes(p) ? ' on' : '')} onClick={() => toggle(p)} aria-pressed={sel.includes(p)}>
                  {sel.includes(p) && <Check size={14} />} {monthName(p)}
                </button>
              ))}
            </div>
          </div>
          <Field label="Amount received (₹)" type="number" min="0" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <div className="field">
            <span className="field-label">Paid by</span>
            <Segmented id="pay-method" value={method} onChange={setMethod} options={METHODS} />
          </div>
          <Field label="Date received" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <button className="btn primary lg"><Check size={18} /> Mark as paid</button>
        </form>
      )}
    </Sheet>
  )
}
