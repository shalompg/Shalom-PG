// Reminder messages + delivery links (WhatsApp, email, UPI).
import { digits } from './store'

export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN')
export const monthName = (p, short) => {
  const [y, m] = p.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-IN', short ? { month: 'short' } : { month: 'long', year: 'numeric' })
}
export const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => new Date(d).toLocaleDateString('en-IN', opts)
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function waNumber(phone) {
  let d = digits(phone)
  if (d.length === 11 && d[0] === '0') d = d.slice(1)
  if (d.length === 10) d = '91' + d
  return d
}

export function upiLink(owner, amount, note) {
  if (!owner?.upiId) return ''
  const q = [
    ['pa', owner.upiId],
    ['pn', owner.upiName || owner.name],
    ['am', String(amount)],
    ['cu', 'INR'],
    ['tn', note],
  ]
  return 'upi://pay?' + q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

export const DEFAULT_TEMPLATE = `Hi {first} 👋

A gentle reminder from {house}: your rent of {amount} for {month} is {when}.

{pay}

Thank you!
— {owner}`

export function whenText(state) {
  if (state.status === 'today') return 'due today'
  if (state.status === 'overdue') {
    const late = -state.days
    const extra = state.months > 1 ? ` (${state.months} months pending)` : ''
    return `overdue since ${fmtDate(state.due)} — ${late} day${late === 1 ? '' : 's'} late${extra}`
  }
  return `due on ${fmtDate(state.due, { weekday: 'short', day: 'numeric', month: 'short' })}`
}

export function payText(owner) {
  // The owner's UPI ID is private: it is never written into messages.
  return owner.payLink ? `Pay here: ${owner.payLink}` : 'Please pay at your earliest convenience.'
}

export function buildMessage({ owner, house, tenant, state }) {
  const tpl = owner.template?.trim() || DEFAULT_TEMPLATE
  const months = state.unpaid?.length > 1 ? state.unpaid.map((p) => monthName(p, true)).join(', ') : monthName(state.period)
  const vars = {
    name: tenant.name,
    first: tenant.name.split(' ')[0],
    house: house?.name || 'your PG',
    room: tenant.room || '',
    amount: inr(state.amount || (tenant.rent || 0) + (tenant.maintenanceMonthly ? tenant.maintenance || 0 : 0)),
    month: months,
    when: whenText(state),
    pay: payText(owner),
    owner: owner.name,
  }
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\n{3,}/g, '\n\n')
}

export const whatsappUrl = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`
export const mailUrl = (email, subject, body) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
export const subjectFor = (house, state) =>
  `Rent reminder — ${house?.name || 'PG'} · ${monthName(state.period)}`
