// Shalom PG data layer.
//
// Two modes, same API:
//  • Cloud  — when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set (.env.local). Data, logins and
//             documents live in Supabase; every change is applied locally first (instant UI) and then
//             written to the server.
//  • Local  — no keys: everything is stored in this browser (great for trying the app out).
import { useSyncExternalStore } from 'react'
import { createClient } from '@supabase/supabase-js'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const cloud = !!(SB_URL && SB_KEY)
export const sb = cloud ? createClient(SB_URL, SB_KEY) : null
const BUCKET = 'documents'

const KEY = 'shalompg:v1'
const SKEY = 'shalompg:session'
const EMPTY = { owners: [], houses: [], tenants: [], payments: [], reminders: [] }

const readLocal = () => {
  if (cloud) return { ...EMPTY }
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    return v ? { ...EMPTY, ...v } : { ...EMPTY }
  } catch {
    return { ...EMPTY }
  }
}
const readSession = () => {
  if (cloud) return null // restored from Supabase auth in boot()
  try {
    return JSON.parse(sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY)) || null
  } catch {
    return null
  }
}

let db = readLocal()
let session = readSession()
let ready = !cloud
const subs = new Set()
const errSubs = new Set()
const emit = () => subs.forEach((f) => f())
const subscribe = (f) => {
  subs.add(f)
  return () => subs.delete(f)
}
export const onSyncError = (f) => {
  errSubs.add(f)
  return () => errSubs.delete(f)
}
const syncError = (msg) => errSubs.forEach((f) => f(msg))

if (!cloud) {
  addEventListener('storage', (e) => {
    if (e.key === KEY) {
      db = readLocal()
      emit()
    }
  })
}

function commit(next) {
  const prev = db
  db = next
  if (!cloud) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db))
    } catch {
      db = prev
      throw new Error('This device is out of storage. Try a smaller photo, or export a backup in Settings.')
    }
  }
  emit()
}
const patchCol = (col, fn) => commit({ ...db, [col]: fn(db[col]) })

function setSession(s) {
  session = s
  if (!cloud) {
    if (s) {
      localStorage.setItem(SKEY, JSON.stringify(s))
      sessionStorage.setItem(SKEY, JSON.stringify(s))
    } else {
      localStorage.removeItem(SKEY)
      sessionStorage.removeItem(SKEY)
    }
  }
  emit()
}

export const useDB = () => useSyncExternalStore(subscribe, () => db)
export const useSession = () => useSyncExternalStore(subscribe, () => session)
export const useReady = () => useSyncExternalStore(subscribe, () => ready)

/** Run a server write in the background; on failure tell the UI and re-sync from the server. */
function remote(fn) {
  if (!cloud) return Promise.resolve()
  return Promise.resolve()
    .then(fn)
    .then((r) => {
      if (r?.error) throw r.error
      return r
    })
    .catch((e) => {
      syncError(e.message || 'Couldn’t save to the cloud. Check your connection.')
      refresh()
    })
}
const must = (r) => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

/* ---------- helpers ---------- */
export const uid = () => crypto.randomUUID()
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPH[b % 32]).join('')
export const digits = (s) => String(s || '').replace(/\D/g, '')
export const last10 = (s) => digits(s).slice(-10)
const normEmail = (e) => String(e || '').trim().toLowerCase()
/** Turn Supabase auth errors into plain language. */
function authMsg(m = '') {
  if (/rate limit/i.test(m)) return 'Too many sign-ups in the last hour. Please wait a little and try again.'
  if (/already registered|already exists/i.test(m)) return 'This email is already registered. Sign in instead.'
  if (/invalid/i.test(m) && /email/i.test(m)) return 'That email address doesn’t look right.'
  if (/password/i.test(m) && /(short|least|weak)/i.test(m)) return 'Use a longer password (at least 6 characters).'
  return m
}

async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/* ---------- cloud row mapping ---------- */
const ownerFrom = (r) => ({
  id: r.id, name: r.name, email: r.email, phone: r.phone || '', upiId: r.upi_id || '', upiName: r.upi_name || '',
  payLink: r.pay_link || '', remindDays: r.remind_days ?? 3, template: r.template || '',
})
const ownerTo = (o) => ({
  name: o.name, phone: o.phone, upi_id: o.upiId, upi_name: o.upiName, pay_link: o.payLink, remind_days: o.remindDays, template: o.template,
})
const houseFrom = (r) => ({ id: r.id, ownerId: r.owner_id, name: r.name, address: r.address || '', hue: r.hue, joinCode: r.join_code })
const houseTo = (h) => ({ id: h.id, owner_id: h.ownerId, name: h.name, address: h.address, hue: h.hue, join_code: h.joinCode })
const tenantFrom = (r) => ({
  id: r.id, ownerId: r.owner_id, houseId: r.house_id, name: r.name, phone: r.phone, email: r.email || '',
  occupation: r.occupation || '', room: r.room || '', rent: r.rent ?? 0, deposit: r.deposit ?? 0, dueDay: r.due_day ?? 5,
  joinedOn: r.joined_on, photoPath: r.photo_path || '', photo: '', idType: r.id_type || 'Aadhaar',
  idDocPath: r.id_doc_path || '', idDoc: r.id_doc_path ? { name: r.id_doc_name || 'ID proof', type: r.id_doc_type || 'image/jpeg', data: '' } : null,
  emergencyName: r.emergency_name || '', emergencyPhone: r.emergency_phone || '', channel: r.channel || 'whatsapp',
  notes: r.notes || '', status: r.status, active: r.active, movedOutOn: r.moved_out_on, createdAt: new Date(r.created_at).getTime(),
})
const TENANT_COLS = {
  houseId: 'house_id', name: 'name', phone: 'phone', email: 'email', occupation: 'occupation', room: 'room', rent: 'rent',
  deposit: 'deposit', dueDay: 'due_day', joinedOn: 'joined_on', idType: 'id_type', emergencyName: 'emergency_name',
  emergencyPhone: 'emergency_phone', channel: 'channel', notes: 'notes', status: 'status', active: 'active', movedOutOn: 'moved_out_on',
  photoPath: 'photo_path', idDocPath: 'id_doc_path',
}
function tenantTo(patch) {
  const row = {}
  for (const [k, c] of Object.entries(TENANT_COLS)) if (k in patch) row[c] = patch[k] === '' && /On$/.test(k) ? null : patch[k]
  if (patch.idDoc && patch.idDocPath) {
    row.id_doc_name = patch.idDoc.name
    row.id_doc_type = patch.idDoc.type
  }
  return row
}
const payFrom = (r) => ({ id: r.id, tenantId: r.tenant_id, ownerId: r.owner_id, period: r.period, amount: r.amount, method: r.method, paidOn: r.paid_on, at: new Date(r.created_at).getTime() })
const remFrom = (r) => ({ id: r.id, tenantId: r.tenant_id, period: r.period, channel: r.channel, at: new Date(r.created_at).getTime() })

/* ---------- cloud files ---------- */
async function dataUrlToBlob(u) {
  return (await fetch(u)).blob()
}
/** Upload any new (data:) photo / ID doc on a tenant patch and return the patch with storage paths. */
async function uploadFiles(ownerId, tenantId, patch) {
  const out = { ...patch }
  const stamp = Date.now()
  if (patch.photo?.startsWith?.('data:')) {
    const path = `${ownerId}/${tenantId}/photo-${stamp}.jpg`
    must(await sb.storage.from(BUCKET).upload(path, await dataUrlToBlob(patch.photo), { contentType: 'image/jpeg', upsert: true }))
    out.photoPath = path
  }
  if (patch.idDoc?.data?.startsWith?.('data:')) {
    const ext = patch.idDoc.type === 'application/pdf' ? 'pdf' : 'jpg'
    const path = `${ownerId}/${tenantId}/id-${stamp}.${ext}`
    must(await sb.storage.from(BUCKET).upload(path, await dataUrlToBlob(patch.idDoc.data), { contentType: patch.idDoc.type, upsert: true }))
    out.idDocPath = path
  }
  return out
}
const signed = new Map() // path -> { url, until }
const LINK_TTL = 60 * 60 // seconds: document links stop working after 1 hour
async function signFiles(tenants) {
  const paths = tenants.flatMap((t) => [t.photoPath, t.idDocPath]).filter(Boolean)
  if (!paths.length) return tenants
  const now = Date.now()
  const stale = paths.filter((p) => !(signed.get(p)?.until > now))
  if (stale.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(stale, LINK_TTL)
    for (const x of data || []) if (x.signedUrl) signed.set(x.path, { url: x.signedUrl, until: now + (LINK_TTL - 600) * 1000 })
  }
  const url = Object.fromEntries(paths.map((p) => [p, signed.get(p)?.url]))
  return tenants.map((t) => ({
    ...t,
    photo: url[t.photoPath] || '',
    idDoc: t.idDoc ? { ...t.idDoc, data: url[t.idDocPath] || '' } : null,
  }))
}

/* ---------- cloud boot & refresh ---------- */
let refreshing = null
export function refresh() {
  if (!cloud || !session) return Promise.resolve()
  refreshing ||= loadOwner().catch((e) => syncError(e.message)).finally(() => (refreshing = null))
  return refreshing
}
async function loadOwner() {
  const [o, h, t, p, r] = await Promise.all([
    sb.from('owners').select('*').eq('id', session.id).single(),
    sb.from('houses').select('*').order('created_at'),
    sb.from('tenants').select('*').order('created_at'),
    sb.from('payments').select('*'),
    sb.from('reminders').select('*').order('created_at', { ascending: false }).limit(500),
  ])
  const tenants = await signFiles(must(t).map(tenantFrom))
  db = {
    owners: [ownerFrom(must(o))], houses: must(h).map(houseFrom), tenants,
    payments: must(p).map(payFrom), reminders: must(r).map(remFrom),
  }
  emit()
}
async function resolveRole(user) {
  const { data: o } = await sb.from('owners').select('id').eq('id', user.id).maybeSingle()
  return o ? { role: 'owner', id: user.id } : null
}
async function boot() {
  try {
    const { data } = await sb.auth.getSession()
    if (data.session) {
      const s = await resolveRole(data.session.user)
      if (s) {
        session = s
        await refresh()
      }
    }
  } catch (e) {
    syncError(e.message)
  }
  ready = true
  emit()
  setInterval(() => document.visibilityState === 'visible' && refresh(), 30000)
  addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh())
}
if (cloud) boot()

/* ---------- owners ---------- */
export async function signUp({ name, email, password }) {
  email = normEmail(email)
  if (password.length < 6) throw new Error('Use at least 6 characters for the password.')
  if (cloud) {
    const r = await sb.auth.signUp({ email, password, options: { data: { role: 'owner', name: name.trim() } } })
    if (r.error) throw new Error(authMsg(r.error.message))
    if (!r.data.session) throw new Error('Almost there — confirm your email from the link we sent, then sign in.')
    setSession({ role: 'owner', id: r.data.user.id })
    await refresh()
    return db.owners[0]
  }
  if (db.owners.some((o) => o.email === email)) throw new Error('An account with this email already exists. Sign in instead.')
  const owner = {
    id: uid(), name: name.trim(), email, passHash: await hash(email + ':' + password), phone: '', upiId: '', upiName: '',
    payLink: '', remindDays: 3, template: '', createdAt: Date.now(),
  }
  patchCol('owners', (a) => [...a, owner])
  setSession({ role: 'owner', id: owner.id })
  return owner
}

/** Owners sign in with email + password. */
export async function signIn({ email, password }) {
  email = normEmail(email)
  if (cloud) {
    const r = await sb.auth.signInWithPassword({ email, password })
    if (r.error) throw new Error(r.error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : r.error.message)
    const s = await resolveRole(r.data.user)
    if (!s) {
      await sb.auth.signOut()
      throw new Error('This account isn’t set up as an owner yet. Ask the family admin to add it.')
    }
    setSession(s)
    await refresh()
    return
  }
  const h = await hash(email + ':' + password)
  const o = db.owners.find((x) => x.email === email)
  if (o && o.passHash === h) return setSession({ role: 'owner', id: o.id })
  throw new Error('That email and password don’t match.')
}

export function signOut() {
  if (cloud) {
    sb.auth.signOut()
    db = { ...EMPTY }
    signed.clear()
  }
  setSession(null)
}
export async function changeOwnerPassword(password) {
  if (password.length < 6) throw new Error('Use at least 6 characters for the password.')
  if (cloud) {
    const r = await sb.auth.updateUser({ password })
    if (r.error) throw new Error(authMsg(r.error.message))
    return
  }
  const o = db.owners.find((x) => x.id === session.id)
  const h = await hash(o.email + ':' + password)
  patchCol('owners', (a) => a.map((x) => (x.id === o.id ? { ...x, passHash: h } : x)))
}
export function updateOwner(id, patch) {
  patchCol('owners', (a) => a.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  const o = db.owners.find((x) => x.id === id)
  remote(() => sb.from('owners').update(ownerTo(o)).eq('id', id))
}

/* ---------- houses ---------- */
export function addHouse(ownerId, { name, address }) {
  const h = { id: uid(), ownerId, name: text(name, 120), address: text(address, 200), hue: Math.floor(Math.random() * 360), joinCode: makeCode(), createdAt: Date.now() }
  patchCol('houses', (a) => [...a, h])
  remote(() => sb.from('houses').insert(houseTo(h)))
  return h
}
export function updateHouse(id, patch) {
  patchCol('houses', (a) => a.map((h) => (h.id === id ? { ...h, ...patch } : h)))
  const h = db.houses.find((x) => x.id === id)
  remote(() => sb.from('houses').update({ name: h.name, address: h.address, hue: h.hue, join_code: h.joinCode }).eq('id', id))
}
export function deleteHouse(id) {
  if (db.tenants.some((t) => t.houseId === id && t.active)) throw new Error('Move residents out of this house before deleting it.')
  patchCol('houses', (a) => a.filter((h) => h.id !== id))
  remote(() => sb.from('houses').delete().eq('id', id))
}

/* ---------- tenants ---------- */
const blankTenant = {
  name: '', phone: '', email: '', occupation: '', room: '', rent: 0, deposit: 0, dueDay: 5,
  joinedOn: isoDay(new Date()), photo: '', idType: 'Aadhaar', idDoc: null,
  emergencyName: '', emergencyPhone: '', channel: 'whatsapp', notes: '',
}
// Strip invisible control characters and cap length on free text.
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max)
const TEXT_FIELDS = { name: 120, occupation: 120, room: 40, emergencyName: 120, idType: 40, notes: 2000 }
export const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i
/** Indian mobile → 10 digits (drops +91 / 0 prefixes). Returns '' if it isn't a valid number. */
export function normPhone(v) {
  let d = digits(v)
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : ''
}
const clean = (t) => {
  for (const [k, max] of Object.entries(TEXT_FIELDS)) if (k in t) t[k] = text(t[k], max)
  if ('rent' in t) t.rent = Math.round(Number(t.rent) || 0)
  if ('deposit' in t) t.deposit = Math.round(Number(t.deposit) || 0)
  if ('dueDay' in t) t.dueDay = Math.min(28, Math.max(1, Math.round(Number(t.dueDay)) || 1))
  if ('email' in t) t.email = normEmail(t.email)
  if ('phone' in t) t.phone = normPhone(t.phone) || text(t.phone, 20)
  if ('emergencyPhone' in t) t.emergencyPhone = normPhone(t.emergencyPhone) || text(t.emergencyPhone, 20)
  return t
}
/** Returns a list of problems with a resident record (empty = OK). */
export function checkTenant(t) {
  const errs = []
  if (!t.name) errs.push('Name is missing')
  if (!normPhone(t.phone)) errs.push('Mobile must be a 10-digit Indian number')
  if (!EMAIL_RE.test(t.email || '')) errs.push('Email is missing or invalid')
  if (!(t.rent > 0) || t.rent > 10000000) errs.push('Monthly rent is missing')
  if (!(t.deposit >= 0) || t.deposit > 100000000) errs.push('Deposit is missing')
  if (!(t.dueDay >= 1 && t.dueDay <= 28)) errs.push('Due day must be 1–28')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.joinedOn || '') || isNaN(new Date(t.joinedOn))) errs.push('Move-in date is invalid')
  return errs
}
const assertTenant = (t) => {
  const e = checkTenant(t)
  if (e.length) throw new Error(e[0] + '.')
}

export function addTenant(ownerId, houseId, data) {
  const t = clean({ ...blankTenant, ...data, id: uid(), ownerId, houseId, status: 'approved', active: true, createdAt: Date.now() })
  assertTenant(t)
  patchCol('tenants', (a) => [...a, t])
  remote(async () => {
    const withFiles = await uploadFiles(ownerId, t.id, t)
    return sb.from('tenants').insert({ id: t.id, owner_id: ownerId, ...tenantTo(withFiles) })
  })
  return t
}

/**
 * Add many residents to one house at once (Excel import). Rows must already be checked.
 * Returns the created residents so the import can be undone.
 */
export async function addTenants(ownerId, houseId, rows) {
  const list = rows.map((data) => clean({ ...blankTenant, ...data, id: uid(), ownerId, houseId, status: 'approved', active: true, createdAt: Date.now() }))
  list.forEach(assertTenant)
  if (cloud) {
    // One request, all-or-nothing: either every row is saved or none are.
    must(await sb.from('tenants').insert(list.map((t) => ({ id: t.id, owner_id: ownerId, ...tenantTo(t) }))))
  }
  patchCol('tenants', (a) => [...a, ...list])
  return list
}

/** Owner edits (any field). */
export function updateTenant(id, patch) {
  patch = clean({ ...patch })
  delete patch.passHash
  const before = db.tenants.find((x) => x.id === id)
  const merged = { ...before, ...patch }
  if (merged.active) assertTenant(merged)
  patchCol('tenants', (a) => a.map((t) => (t.id === id ? merged : t)))
  remote(async () => {
    const withFiles = await uploadFiles(before.ownerId, id, patch)
    const res = await sb.from('tenants').update(tenantTo(withFiles)).eq('id', id)
    if (res.error) return res
    // Replaced documents: delete the old file so no stale copy of someone's ID is left behind.
    const old = [
      withFiles.photoPath && before.photoPath !== withFiles.photoPath && before.photoPath,
      withFiles.idDocPath && before.idDocPath !== withFiles.idDocPath && before.idDocPath,
    ].filter(Boolean)
    if (old.length) await sb.storage.from(BUCKET).remove(old)
    patchCol('tenants', (a) => a.map((t) => (t.id === id ? { ...t, photoPath: withFiles.photoPath || t.photoPath, idDocPath: withFiles.idDocPath || t.idDocPath } : t)))
    return res
  })
}

/** Permanently erase a resident: their record, payments, reminders, photo and ID document. */
export async function deleteTenant(id) {
  const t = db.tenants.find((x) => x.id === id)
  if (!t) return
  if (cloud) {
    const { data: files } = await sb.storage.from(BUCKET).list(`${t.ownerId}/${id}`, { limit: 100 })
    const paths = (files || []).map((f) => `${t.ownerId}/${id}/${f.name}`)
    if (paths.length) must(await sb.storage.from(BUCKET).remove(paths))
    must(await sb.from('tenants').delete().eq('id', id))
  }
  commit({
    ...db,
    tenants: db.tenants.filter((x) => x.id !== id),
    payments: db.payments.filter((p) => p.tenantId !== id),
    reminders: db.reminders.filter((x) => x.tenantId !== id),
  })
}

export const moveOut = (id) => updateTenant(id, { active: false, movedOutOn: isoDay(new Date()) })

/* ---------- payments & reminders ---------- */
export function markPaid(tenantId, period, amount, method = 'UPI', paidOn) {
  const t = db.tenants.find((x) => x.id === tenantId)
  const p = {
    id: uid(), tenantId, ownerId: t?.ownerId, period, amount: Number(amount) || 0, method,
    paidOn: paidOn || isoDay(new Date()), at: paidOn ? new Date(paidOn).getTime() : Date.now(),
  }
  patchCol('payments', (a) => [...a.filter((x) => !(x.tenantId === tenantId && x.period === period)), p])
  remote(() => sb.from('payments').upsert(
    { id: p.id, tenant_id: tenantId, owner_id: p.ownerId, period, amount: p.amount, method, paid_on: p.paidOn },
    { onConflict: 'tenant_id,period' },
  ))
  return p
}
export function undoPayment(id) {
  patchCol('payments', (a) => a.filter((p) => p.id !== id))
  remote(() => sb.from('payments').delete().eq('id', id))
}

export function logReminder(tenantId, period, channel) {
  const t = db.tenants.find((x) => x.id === tenantId)
  const r = { id: uid(), tenantId, period, channel, at: Date.now() }
  patchCol('reminders', (a) => [...a, r])
  remote(() => sb.from('reminders').insert({ id: r.id, tenant_id: tenantId, owner_id: t.ownerId, period, channel }))
}

/* ---------- rent engine ---------- */
export const today = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
export const periodOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
export function dueDateFor(t, period) {
  const [y, m] = period.split('-').map(Number)
  const dim = new Date(y, m, 0).getDate()
  return new Date(y, m - 1, Math.min(t.dueDay, dim))
}
const nextPeriod = (p) => {
  let [y, m] = p.split('-').map(Number)
  m++
  if (m > 12) { m = 1; y++ }
  return `${y}-${pad(m)}`
}
const DAY = 864e5

/**
 * Where a resident stands right now.
 * status: 'pending' | 'overdue' | 'today' | 'soon' | 'paid' | 'scheduled' | 'left'
 */
export function rentState(t, payments, remindDays = 3) {
  if (!t.active) return { status: 'left', amount: 0, unpaid: [] }
  if (t.status === 'pending') return { status: 'pending', amount: 0, unpaid: [] }
  const now = today()
  const cur = periodOf(now)
  const mine = payments.filter((p) => p.tenantId === t.id)
  const paid = new Set(mine.map((p) => p.period))
  const joined = new Date(t.joinedOn + 'T00:00:00')

  // Every month since move-in whose due date has arrived and has no payment.
  const unpaid = []
  let p = periodOf(joined)
  while (p <= cur) {
    const dd = dueDateFor(t, p)
    if (dd >= joined && dd <= now && !paid.has(p)) unpaid.push(p)
    p = nextPeriod(p)
  }
  const overdue = unpaid.filter((x) => dueDateFor(t, x) < now)
  const curDue = dueDateFor(t, cur)
  const curPaid = paid.has(cur)
  const daysToCur = Math.round((curDue - now) / DAY)

  let status, period, due
  if (overdue.length) {
    status = 'overdue'
    period = overdue[0]
    due = dueDateFor(t, period)
  } else if (!curPaid && daysToCur === 0 && curDue >= joined) {
    status = 'today'; period = cur; due = curDue
  } else if (!curPaid && daysToCur > 0 && curDue >= joined) {
    status = daysToCur <= remindDays ? 'soon' : 'scheduled'
    period = cur; due = curDue
  } else {
    // This month is settled (or wasn't billable yet) → the next due date is what's coming.
    period = nextPeriod(cur)
    due = dueDateFor(t, period)
    while (due < joined) { period = nextPeriod(period); due = dueDateFor(t, period) }
    const d = Math.round((due - now) / DAY)
    status = curPaid ? 'paid' : d <= remindDays ? 'soon' : 'scheduled'
  }
  const months = status === 'overdue' ? unpaid.length : status === 'paid' || status === 'scheduled' ? 0 : 1
  return {
    status,
    period,
    due,
    days: Math.round((due - now) / DAY), // negative = late
    unpaid,
    // The months a payment made right now would cover.
    payFor: unpaid.length ? unpaid : [period],
    months,
    amount: months * (t.rent || 0),
    lastPayment: [...mine].sort((a, b) => b.at - a.at)[0],
  }
}

/* ---------- backup ---------- */
export function exportOwner(ownerId) {
  const houses = db.houses.filter((h) => h.ownerId === ownerId)
  // In the cloud, leave out the temporary document links so the file can't be used to open anyone's ID.
  const tenants = db.tenants
    .filter((t) => t.ownerId === ownerId)
    .map(({ passHash, ...t }) => (cloud ? { ...t, photo: '', idDoc: t.idDoc ? { ...t.idDoc, data: '' } : null } : t)) // eslint-disable-line no-unused-vars
  const ids = new Set(tenants.map((t) => t.id))
  return {
    app: 'shalom-pg', version: 1, exportedAt: new Date().toISOString(),
    owner: { ...db.owners.find((o) => o.id === ownerId), passHash: undefined },
    houses, tenants,
    payments: db.payments.filter((p) => ids.has(p.tenantId)),
    reminders: db.reminders.filter((r) => ids.has(r.tenantId)),
  }
}
export function importOwner(ownerId, data) {
  if (cloud) throw new Error('Restoring a backup is only available in offline mode.')
  if (data?.app !== 'shalom-pg') throw new Error('That file isn’t a Shalom PG backup.')
  const fix = (x) => ({ ...x, ownerId })
  const keep = (col, list = []) => [...db[col].filter((x) => !list.some((y) => y.id === x.id)), ...list]
  commit({
    ...db,
    houses: keep('houses', data.houses.map(fix)),
    tenants: keep('tenants', data.tenants.map(fix)),
    payments: keep('payments', data.payments),
    reminders: keep('reminders', data.reminders),
  })
}

/* ---------- demo (offline mode only) ---------- */
export async function seedDemo() {
  if (cloud) return
  const email = 'demo@shalompg.app'
  const existing = db.owners.find((x) => x.email === email)
  if (existing) return setSession({ role: 'owner', id: existing.id })
  const o = await signUp({ name: 'Demo Owner', email, password: 'demo1234' })
  updateOwner(o.id, { phone: '9800000000' })
  const h1 = addHouse(o.id, { name: 'Lotus House', address: '14, 3rd Cross, Koramangala' })
  const h2 = addHouse(o.id, { name: 'Banyan Residency', address: '7 Church Road, Indiranagar' })
  updateHouse(h1.id, { hue: 152 })
  updateHouse(h2.id, { hue: 24 })
  const now = today()
  const d = now.getDate()
  const back = (months) => isoDay(new Date(now.getFullYear(), now.getMonth() - months, 1))
  const dayIn = (n) => ((d - 1 + n + 28) % 28) + 1 // due day n days from today (wraps within 1..28)
  const people = [
    [h1, 'Ananya Rao', '9876543210', 'ananya.rao@example.com', '101', 9500, dayIn(0), 'Software engineer'],
    [h1, 'Rohit Menon', '9845012345', 'rohit.m@example.com', '102', 9000, dayIn(-4), 'MBA student'],
    [h1, 'Priya Shah', '9900112233', 'priya.shah@example.com', '201', 11000, dayIn(1), 'Designer'],
    [h1, 'Karan Gill', '9811122233', 'karan.gill@example.com', '202', 9500, dayIn(-10), 'Analyst'],
    [h2, 'Meera Iyer', '9822334455', 'meera.i@example.com', 'A1', 8500, dayIn(1), 'Nurse'],
    [h2, 'Arjun Das', '9833445566', 'arjun.das@example.com', 'A2', 8500, dayIn(-2), 'Student'],
    [h2, 'Sneha Kulkarni', '9844556677', 'sneha.k@example.com', 'B1', 10000, dayIn(12), 'Teacher'],
    [h2, 'Dev Malhotra', '9866778899', 'dev.m@example.com', 'B2', 9000, dayIn(5), 'Photographer'],
  ]
  for (const [h, name, phone, mail, room, rent, dueDay, occupation] of people) {
    const t = addTenant(o.id, h.id, {
      name, phone, email: mail, room, rent, deposit: rent * 2, dueDay, occupation, joinedOn: back(3),
      emergencyName: 'Parent', emergencyPhone: '9000000000',
    })
    let p = periodOf(new Date(t.joinedOn))
    const cur = periodOf(now)
    while (p < cur) { markPaid(t.id, p, rent, 'UPI', isoDay(dueDateFor(t, p))); p = nextPeriod(p) }
    if (name === 'Sneha Kulkarni') markPaid(t.id, cur, rent)
    if (name === 'Karan Gill') undoPayment(db.payments.filter((x) => x.tenantId === t.id).sort((a, b) => b.period.localeCompare(a.period))[0].id)
  }
  setSession({ role: 'owner', id: o.id })
}
