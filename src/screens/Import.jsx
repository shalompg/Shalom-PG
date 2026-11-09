// Bulk-add residents from an Excel (.xlsx / .xls) or CSV file — into one house, or into many at once.
import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileSpreadsheet, Download, Upload, Check, AlertCircle, RefreshCw } from 'lucide-react'
import { addTenants, deleteTenant, checkTenant, normPhone, isoDay, periodOf, today } from '../store'
import { inr, monthName } from '../reminders'
import { Sheet, useToast, ease } from '../ui'
import { useOwner } from './Owner'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 500

// Column headings we understand (case, spaces and punctuation don't matter).
const COLUMNS = {
  house: ['house', 'housename', 'pg', 'pgname', 'building', 'property', 'block'],
  name: ['name', 'fullname', 'residentname', 'tenantname', 'guestname'],
  phone: ['mobile', 'phone', 'phonenumber', 'mobilenumber', 'contact', 'contactnumber', 'whatsapp'],
  email: ['email', 'emailid', 'emailaddress', 'mail'],
  room: ['room', 'roomno', 'roomnumber', 'bed', 'roombed'],
  rent: ['rent', 'monthlyrent', 'rentpermonth', 'rentamount'],
  deposit: ['deposit', 'securitydeposit', 'advance', 'refundabledeposit'],
  maintenance: ['maintenance', 'maintenancecharge', 'maintenancecharges', 'maintenanceamount', 'maintenancefee'],
  maintenanceType: ['maintenancetype', 'maintenancefrequency', 'maintenancecharged', 'maintenanceis'],
  dueDay: ['dueday', 'duedate', 'rentdueday', 'rentdue', 'due'],
  joinedOn: ['movedin', 'moveindate', 'joinedon', 'joiningdate', 'joindate', 'checkin', 'startdate'],
  paidUpTo: ['paidupto', 'paidtill', 'paiduntil', 'rentpaidupto', 'lastpaidmonth', 'paidthrough', 'paidto'],
  occupation: ['occupation', 'work', 'job', 'college', 'company'],
  emergencyName: ['emergencycontact', 'emergencyname', 'emergencycontactname', 'guardian', 'guardianname', 'parentname'],
  emergencyPhone: ['emergencyphone', 'emergencycontactphone', 'emergencynumber', 'guardianphone', 'parentphone'],
  idType: ['idtype', 'idproof', 'idprooftype'],
  channel: ['reminders', 'reminderson', 'sendremindersvia', 'channel'],
  notes: ['notes', 'remarks', 'comments'],
}
const BASE_HEADERS = [
  'Name', 'Mobile', 'Email', 'Room', 'Monthly rent', 'Deposit', 'Maintenance', 'Maintenance type', 'Due day', 'Moved in', 'Paid up to',
  'Occupation', 'Emergency contact', 'Emergency phone', 'ID type', 'Reminders', 'Notes',
]
const key = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '')
const lookup = Object.fromEntries(Object.entries(COLUMNS).flatMap(([field, names]) => names.map((n) => [n, field])))

const loadXLSX = () => import('xlsx') // loaded only when someone imports, keeps the app fast

function toNumber(v) {
  if (typeof v === 'number') return v
  const d = String(v ?? '').replace(/[^\d.]/g, '')
  return d ? Number(d) : NaN
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad2 = (n) => String(n).padStart(2, '0')
function toDate(v, XLSX) {
  if (v === '' || v == null) return isoDay(new Date())
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v)
    if (p) return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) // 2026-10-01
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/) // 01/10/2026 (day first, as in India)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad2(m[2])}-${pad2(m[1])}`
  m = s.match(/^(\d{1,2})\s*([a-z]{3})[a-z]*\.?,?\s*(\d{4})$/i) // 1 Oct 2026
  if (m && MONTHS.includes(m[2].toLowerCase())) return `${m[3]}-${pad2(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad2(m[1])}`
  return 'invalid'
}
/** "Oct 2026", "October 2026", "10/2026", "2026-10", a full date, or an Excel date → 'YYYY-MM'. '' if empty. */
function toMonth(v, XLSX) {
  if (v === '' || v == null) return ''
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v)
    return p ? `${p.y}-${pad2(p.m)}` : 'invalid'
  }
  const s = String(v).trim()
  let m = s.match(/^([a-z]{3,9})\.?[\s,'-]*(\d{2,4})$/i) // Oct 2026, October-26
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) {
    const y = m[2].length === 2 ? '20' + m[2] : m[2]
    return `${y}-${pad2(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1)}`
  }
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/) // 10/2026
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad2(m[1])}`
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/) // 2026-10
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad2(m[2])}`
  const d = toDate(s, XLSX) // a full date: use its month
  return d === 'invalid' ? 'invalid' : d.slice(0, 7)
}
function toDueDay(v, XLSX) {
  if (typeof v === 'number' && v > 31) return XLSX.SSF.parse_date_code(v)?.d ?? NaN // a full date was typed
  const n = toNumber(String(v).replace(/(st|nd|rd|th)$/i, ''))
  return Number.isInteger(n) ? n : NaN
}
function toChannel(v) {
  const s = key(v)
  if (s.includes('both')) return 'both'
  if (s.includes('mail')) return 'email'
  return 'whatsapp'
}

/** Turn spreadsheet rows into checked resident records. */
function parseRows(json, XLSX, existingPhones, houseIdFor) {
  const seen = new Set()
  const thisMonth = periodOf(today())
  return json
    .map((raw, i) => {
      const r = {}
      for (const [h, v] of Object.entries(raw)) {
        const f = lookup[key(h)]
        if (f && r[f] === undefined) r[f] = v
      }
      const isEmpty = Object.values(r).every((v) => String(v ?? '').trim() === '')
      if (isEmpty) return null
      const t = {
        name: String(r.name ?? '').trim(),
        phone: normPhone(r.phone),
        email: String(r.email ?? '').trim().toLowerCase(),
        room: String(r.room ?? '').trim(),
        rent: toNumber(r.rent),
        deposit: r.deposit === '' || r.deposit == null ? NaN : toNumber(r.deposit),
        maintenance: r.maintenance === '' || r.maintenance == null ? 0 : toNumber(r.maintenance),
        maintenanceMonthly: /month/i.test(String(r.maintenanceType ?? '')),
        dueDay: toDueDay(r.dueDay ?? '', XLSX),
        joinedOn: toDate(r.joinedOn, XLSX),
        occupation: String(r.occupation ?? '').trim(),
        emergencyName: String(r.emergencyName ?? '').trim(),
        emergencyPhone: normPhone(r.emergencyPhone) || String(r.emergencyPhone ?? '').trim(),
        idType: String(r.idType ?? '').trim() || 'Aadhaar',
        channel: toChannel(r.channel ?? ''),
        notes: String(r.notes ?? '').trim(),
      }
      const errors = checkTenant(t)
      const pi = errors.indexOf('Mobile must be a 10-digit Indian number')
      if (pi >= 0 && String(r.phone ?? '').trim()) errors[pi] = `Mobile “${String(r.phone).slice(0, 20)}” isn’t a 10-digit number`
      if (t.phone && existingPhones.has(t.phone)) errors.push('Already added (same mobile)')
      else if (t.phone && seen.has(t.phone)) errors.push('Listed twice in this file')
      if (t.phone) seen.add(t.phone)

      const paidUpTo = toMonth(r.paidUpTo, XLSX)
      if (paidUpTo === 'invalid') errors.push(`“Paid up to” (${String(r.paidUpTo).slice(0, 20)}) isn’t a month, e.g. Oct 2026`)
      else if (paidUpTo && t.joinedOn !== 'invalid' && paidUpTo < t.joinedOn.slice(0, 7)) errors.push('“Paid up to” is before they moved in')
      else if (paidUpTo > thisMonth) errors.push('“Paid up to” can’t be a future month')

      const houseText = String(r.house ?? '').trim()
      return { row: i + 2, t, errors, paidUpTo: paidUpTo === 'invalid' ? '' : paidUpTo, houseText, houseId: houseIdFor(houseText) }
    })
    .filter(Boolean)
}

async function downloadTemplate(houses, withHouse) {
  const XLSX = await loadXLSX()
  const wb = XLSX.utils.book_new()
  const headers = withHouse ? ['House', ...BASE_HEADERS] : BASE_HEADERS
  const example = ['Ananya Rao', '9876543210', 'ananya@gmail.com', '101', 9500, 19000, 500, 'Monthly', 5, '01/03/2026', 'Oct 2026', 'Software engineer', 'Ravi Rao', '9812345678', 'Aadhaar', 'WhatsApp', '']
  const ws = XLSX.utils.aoa_to_sheet([headers, withHouse ? [houses[0]?.name || '', ...example] : example])
  ws['!cols'] = headers.map((h) => ({ wch: h === 'House' ? 22 : Math.max(12, h.length + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Residents')
  if (withHouse) {
    const hs = XLSX.utils.aoa_to_sheet([['Your houses (copy the name exactly)'], ...houses.map((h) => [h.name])])
    hs['!cols'] = [{ wch: 40 }]
    XLSX.utils.book_append_sheet(wb, hs, 'Houses')
  }
  const help = XLSX.utils.aoa_to_sheet([
    ['How to fill the Residents sheet'],
    [''],
    ['Required', `${withHouse ? 'House (as listed on the Houses sheet), ' : ''}Name, Mobile (10 digits), Monthly rent, Deposit (0 if none), Due day (1–30)`],
    ['Paid up to', 'For people who joined a while back: the last month they have already paid, e.g. Oct 2026. Every month up to it is marked as paid. Leave empty if nothing is paid yet.'],
    ['Optional', 'Email, Room, Maintenance amount, Maintenance type (One-time or Monthly; one-time if empty), Moved in (DD/MM/YYYY, today if empty), Occupation, Emergency contact + phone, ID type, Reminders (WhatsApp / Email / Both), Notes'],
    ['Tip', 'One person per row. Delete the example row before adding your residents. You can also pick or fix each house from a dropdown after uploading.'],
    ['Photos & ID', 'Add each person’s photo and ID proof in the app after importing.'],
  ])
  help['!cols'] = [{ wch: 14 }, { wch: 120 }]
  XLSX.utils.book_append_sheet(wb, help, 'How to fill')
  XLSX.writeFile(wb, 'Shalom-PG-residents-template.xlsx')
}

/** houseId given → everyone goes into that house. No houseId → each row picks its house (from the sheet or a dropdown). */
export function ImportSheet({ open, onClose, houseId }) {
  const { owner, tenants, houses } = useOwner()
  const toast = useToast()
  const fileRef = useRef()
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fixedHouse = houses.find((h) => h.id === houseId)
  const multi = !fixedHouse

  const reset = () => {
    setRows(null)
    setFileName('')
    setErr('')
  }
  const close = () => {
    reset()
    onClose()
  }

  const houseIdFor = (text) => {
    if (fixedHouse) return fixedHouse.id
    if (houses.length === 1) return houses[0].id
    const k = key(text)
    if (!k) return ''
    return (houses.find((h) => key(h.name) === k) || houses.find((h) => key(h.name).startsWith(k) || k.startsWith(key(h.name))))?.id || ''
  }

  const read = async (file) => {
    setErr('')
    if (!file) return
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return setErr('Please choose an Excel file (.xlsx or .xls) or a .csv file.')
    if (file.size > MAX_BYTES) return setErr('That file is over 2 MB. Please remove extra sheets or images and try again.')
    setBusy(true)
    try {
      const XLSX = await loadXLSX()
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: false, cellHTML: false, sheetRows: MAX_ROWS + 2 })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true })
      const headers = Object.keys(json[0] || {}).map(key)
      if (!headers.some((h) => lookup[h] === 'name') || !headers.some((h) => lookup[h] === 'phone')) {
        throw new Error('Couldn’t find “Name” and “Mobile” columns in the first sheet. Download the template to see the expected columns.')
      }
      const existing = new Set(tenants.filter((t) => t.active).map((t) => normPhone(t.phone)).filter(Boolean))
      const parsed = parseRows(json, XLSX, existing, houseIdFor)
      if (!parsed.length) throw new Error('That sheet has no residents in it.')
      if (parsed.length > MAX_ROWS) throw new Error(`Please import at most ${MAX_ROWS} people at a time.`)
      setRows(parsed)
      setFileName(file.name)
    } catch (x) {
      setErr(x.message || 'Couldn’t read that file.')
    } finally {
      setBusy(false)
    }
  }

  const setHouse = (row, id) => setRows((rs) => rs.map((r) => (r.row === row ? { ...r, houseId: id } : r)))
  const setAllHouses = (id) => id && setRows((rs) => rs.map((r) => (r.houseId ? r : { ...r, houseId: id })))

  const problems = (r) => [...r.errors, ...(r.houseId ? [] : [r.houseText ? `House “${r.houseText.slice(0, 30)}” not found: choose one` : 'Choose a house'])]
  const good = rows?.filter((r) => !problems(r).length) || []
  const bad = rows?.filter((r) => problems(r).length) || []
  const noHouse = rows?.filter((r) => !r.houseId).length || 0
  const backfilled = good.filter((r) => r.paidUpTo).length

  const doImport = async () => {
    setBusy(true)
    try {
      const created = await addTenants(owner.id, houseId, good.map((r) => ({ ...r.t, houseId: r.houseId, paidUpTo: r.paidUpTo })))
      const houseCount = new Set(created.map((t) => t.houseId)).size
      toast(`${created.length} resident${created.length === 1 ? '' : 's'} added${fixedHouse ? ` to ${fixedHouse.name}` : ` across ${houseCount} house${houseCount === 1 ? '' : 's'}`}`, {
        tone: 'ok',
        ms: 8000,
        action: { label: 'Undo', run: () => created.forEach((t) => deleteTenant(t.id)) },
      })
      close()
    } catch (x) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={close} title="Import from Excel" subtitle={fixedHouse ? `Add many people to ${fixedHouse.name} at once` : 'Add people to any of your houses at once'} size="lg"
      footer={rows && (
        <>
          <button className="btn ghost" onClick={reset}><RefreshCw size={15} /> Another file</button>
          <button className="btn primary" disabled={!good.length || busy} onClick={doImport}>
            <Check size={16} /> {busy ? 'Adding…' : `Add ${good.length} resident${good.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!rows ? (
          <motion.div key="pick" className="stack" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
            <ol className="import-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Get the template</strong>
                  <p>
                    One row per person. Required: {multi && 'house, '}name, mobile, rent, deposit and due day (1–30).
                    For people who joined a while back, fill <b>Paid up to</b> (e.g. Oct 2026) so earlier months aren’t shown as unpaid.
                  </p>
                  <button type="button" className="btn sm" onClick={() => downloadTemplate(houses, multi)}><Download size={15} /> Download template</button>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Upload the filled sheet</strong>
                  <p>We’ll check every row before anything is saved{multi ? ', and you can pick or correct each house from a dropdown' : ''}.</p>
                </div>
              </li>
            </ol>
            <button type="button" className="drop" onClick={() => fileRef.current.click()} disabled={busy}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); read(e.dataTransfer.files[0]) }}>
              <FileSpreadsheet size={30} />
              <strong>{busy ? 'Reading…' : 'Choose Excel file'}</strong>
              <small>.xlsx, .xls or .csv · up to {MAX_ROWS} people</small>
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden
              onChange={(e) => { read(e.target.files[0]); e.target.value = '' }} />
            {err && <p className="form-err">{err}</p>}
            <p className="muted small">Photos and ID documents can’t go in a spreadsheet. Add them for each person afterwards.</p>
          </motion.div>
        ) : (
          <motion.div key="preview" className="stack" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
            <div className="import-summary">
              <div className="ok"><Check size={16} /> <b>{good.length}</b> ready</div>
              {bad.length > 0 && <div className="bad"><AlertCircle size={16} /> <b>{bad.length}</b> need fixing</div>}
              <span className="muted small">{fileName}</span>
            </div>
            {multi && noHouse > 0 && (
              <div className="import-bulk-house">
                <span><b>{noHouse}</b> row{noHouse === 1 ? ' has' : 's have'} no house yet.</span>
                <select defaultValue="" onChange={(e) => { setAllHouses(e.target.value); e.target.value = '' }} aria-label="Put rows without a house into">
                  <option value="" disabled>Put them all in…</option>
                  {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            )}
            {backfilled > 0 && (
              <p className="hint-box">{backfilled} {backfilled === 1 ? 'person has' : 'people have'} a “Paid up to” month: every month up to it will be marked as paid earlier.</p>
            )}
            {bad.length > 0 && (
              <p className="hint-box">Rows with problems are skipped. Fix them here (house) or in the sheet and import it again; people already added are detected and won’t be duplicated.</p>
            )}
            <div className={'import-table' + (multi ? ' multi' : '')} role="table">
              <div className="it-row it-head" role="row">
                <span>Row</span><span>Name</span>{multi && <span>House</span>}<span>Mobile</span><span>Room</span><span>Rent</span><span>Due</span><span>Paid up to</span><span>Status</span>
              </div>
              {[...bad, ...good].map((r) => {
                const p = problems(r)
                return (
                  <div key={r.row} className={'it-row' + (p.length ? ' has-err' : '')} role="row">
                    <span className="muted">{r.row}</span>
                    <span className="it-name">{r.t.name || '—'}</span>
                    {multi && (
                      <span>
                        <select className={'it-house' + (r.houseId ? '' : ' empty')} value={r.houseId} onChange={(e) => setHouse(r.row, e.target.value)} aria-label={`House for ${r.t.name || 'row ' + r.row}`}>
                          <option value="">Choose…</option>
                          {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                        </select>
                      </span>
                    )}
                    <span>{r.t.phone || '—'}</span>
                    <span>{r.t.room || '—'}</span>
                    <span>{r.t.rent > 0 ? inr(r.t.rent) : '—'}</span>
                    <span>{r.t.dueDay >= 1 ? r.t.dueDay : '—'}</span>
                    <span>{r.paidUpTo ? monthName(r.paidUpTo).replace(/ \d{4}$/, (y) => ' ’' + y.slice(-2)) : '—'}</span>
                    <span className="it-status">{p.length ? p.join(' · ') : <><Check size={14} /> Ready</>}</span>
                  </div>
                )
              })}
            </div>
            {err && <p className="form-err">{err}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}

export function ImportButton({ houseId, className = 'btn sm', label = 'Import from Excel' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}><Upload size={14} /> <span className="hide-sm-text">{label}</span></button>
      <ImportSheet open={open} onClose={() => setOpen(false)} houseId={houseId} />
    </>
  )
}
