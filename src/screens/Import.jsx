// Bulk-add residents to a house from an Excel (.xlsx / .xls) or CSV file.
import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileSpreadsheet, Download, Upload, Check, AlertCircle, RefreshCw } from 'lucide-react'
import { addTenants, deleteTenant, checkTenant, normPhone, isoDay } from '../store'
import { inr } from '../reminders'
import { Sheet, useToast, ease } from '../ui'
import { useOwner } from './Owner'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 500

// Column headings we understand (case, spaces and punctuation don't matter).
const COLUMNS = {
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
  occupation: ['occupation', 'work', 'job', 'college', 'company'],
  emergencyName: ['emergencycontact', 'emergencyname', 'emergencycontactname', 'guardian', 'guardianname', 'parentname'],
  emergencyPhone: ['emergencyphone', 'emergencycontactphone', 'emergencynumber', 'guardianphone', 'parentphone'],
  idType: ['idtype', 'idproof', 'idprooftype'],
  channel: ['reminders', 'reminderson', 'sendremindersvia', 'channel'],
  notes: ['notes', 'remarks', 'comments'],
}
const TEMPLATE_HEADERS = [
  'Name', 'Mobile', 'Email', 'Room', 'Monthly rent', 'Deposit', 'Maintenance', 'Maintenance type', 'Due day', 'Moved in',
  'Occupation', 'Emergency contact', 'Emergency phone', 'ID type', 'Reminders', 'Notes',
]
const key = (h) => String(h).toLowerCase().replace(/[^a-z]/g, '')
const lookup = Object.fromEntries(Object.entries(COLUMNS).flatMap(([field, names]) => names.map((n) => [n, field])))

const loadXLSX = () => import('xlsx') // loaded only when someone imports, keeps the app fast

function toNumber(v) {
  if (typeof v === 'number') return v
  const d = String(v ?? '').replace(/[^\d.]/g, '')
  return d ? Number(d) : NaN
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function toDate(v, XLSX) {
  if (v === '' || v == null) return isoDay(new Date())
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v)
    if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) // 2026-10-01
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/) // 01/10/2026 (day first, as in India)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\s*([a-z]{3})[a-z]*\.?,?\s*(\d{4})$/i) // 1 Oct 2026
  if (m && MONTHS.includes(m[2].toLowerCase())) return `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return 'invalid'
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
function parseRows(json, XLSX, existingPhones) {
  const seen = new Set()
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
      return { row: i + 2, t, errors } // +2: header row, and Excel counts from 1
    })
    .filter(Boolean)
}

async function downloadTemplate() {
  const XLSX = await loadXLSX()
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['Ananya Rao', '9876543210', 'ananya@gmail.com', '101', 9500, 19000, 500, 'Monthly', 5, '01/10/2026', 'Software engineer', 'Ravi Rao', '9812345678', 'Aadhaar', 'WhatsApp', ''],
  ])
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Residents')
  const help = XLSX.utils.aoa_to_sheet([
    ['How to fill the Residents sheet'],
    [''],
    ['Required', 'Name, Mobile (10 digits), Monthly rent, Deposit (0 if none), Due day (1–30)'],
    ['Optional', 'Email, Room, Maintenance amount, Maintenance type (One-time or Monthly; one-time if empty), Moved in (DD/MM/YYYY, today if empty), Occupation, Emergency contact + phone, ID type, Reminders (WhatsApp / Email / Both), Notes'],
    ['Tip', 'One person per row. Delete the example row before adding your residents.'],
    ['Photos & ID', 'Add each person’s photo and ID proof in the app after importing.'],
  ])
  help['!cols'] = [{ wch: 14 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(wb, help, 'How to fill')
  XLSX.writeFile(wb, 'Shalom-PG-residents-template.xlsx')
}

export function ImportSheet({ open, onClose, houseId }) {
  const { owner, tenants, houses } = useOwner()
  const toast = useToast()
  const fileRef = useRef()
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const house = houses.find((h) => h.id === houseId)

  const reset = () => {
    setRows(null)
    setFileName('')
    setErr('')
  }
  const close = () => {
    reset()
    onClose()
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
      const parsed = parseRows(json, XLSX, existing)
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

  const good = rows?.filter((r) => !r.errors.length) || []
  const bad = rows?.filter((r) => r.errors.length) || []

  const doImport = async () => {
    setBusy(true)
    try {
      const created = await addTenants(owner.id, houseId, good.map((r) => r.t))
      toast(`${created.length} resident${created.length === 1 ? '' : 's'} added to ${house?.name}`, {
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
    <Sheet open={open} onClose={close} title="Import from Excel" subtitle={house ? `Add many people to ${house.name} at once` : ''} size="lg"
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
                  <p>One row per person. Required: name, mobile, rent, deposit and due day (1–30). Email and maintenance are optional. Your own sheet works too if the column names are similar.</p>
                  <button type="button" className="btn sm" onClick={downloadTemplate}><Download size={15} /> Download template</button>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Upload the filled sheet</strong>
                  <p>We’ll check every row before anything is saved.</p>
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
            {bad.length > 0 && (
              <p className="hint-box">Rows with problems are skipped. Fix them in the sheet and import that file again later; people already added are detected and won’t be duplicated.</p>
            )}
            <div className="import-table" role="table">
              <div className="it-row it-head" role="row">
                <span>Row</span><span>Name</span><span>Mobile</span><span>Room</span><span>Rent</span><span>Due</span><span>Status</span>
              </div>
              {[...bad, ...good].map(({ row, t, errors }) => (
                <div key={row} className={'it-row' + (errors.length ? ' has-err' : '')} role="row">
                  <span className="muted">{row}</span>
                  <span className="it-name">{t.name || '—'}</span>
                  <span>{t.phone || '—'}</span>
                  <span>{t.room || '—'}</span>
                  <span>{t.rent > 0 ? inr(t.rent) : '—'}</span>
                  <span>{t.dueDay >= 1 ? t.dueDay : '—'}</span>
                  <span className="it-status">{errors.length ? errors.join(' · ') : <><Check size={14} /> Ready</>}</span>
                </div>
              ))}
            </div>
            {err && <p className="form-err">{err}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}

export function ImportButton({ houseId, className = 'btn sm' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}><Upload size={14} /> Import from Excel</button>
      <ImportSheet open={open} onClose={() => setOpen(false)} houseId={houseId} />
    </>
  )
}
