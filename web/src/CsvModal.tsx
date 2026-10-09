import { useMemo, useState } from 'react'
import { CircleAlert, CircleCheck, FileUp, KeyRound, Link2, MapPinned, Upload } from 'lucide-react'
import type { Lang } from './settings'
import { detect, parseTable, type NameRef, type Parsed } from './csv'
import { Button, inputCls, Modal } from './ui'

interface Props {
  lang: Lang
  theme: 'dark' | 'light'
  countries: NameRef[]
  regions: NameRef[]
  onShow: (p: Parsed, title: string, unit: string) => void
  onSaved: (id: string) => void
  onClose: () => void
}

const KEY_STORE = 'geovis.apiKey'
const EXAMPLE = 'Страна;Год;Значение\nРоссия;2015;1,36\nРоссия;2024;2,19\nКазахстан;2015;0,18\nКазахстан;2024;0,29'

/** «Свои данные»: CSV/TSV файлом, перетаскиванием или вставкой из Excel → карта (в браузере) или ссылка (через API). */
export default function CsvModal({ lang, theme, countries, regions, onShow, onSaved, onClose }: Props) {
  const ru = lang === 'ru'
  const [text, setText] = useState('')
  const [title, setTitle] = useState(ru ? 'Мои данные' : 'My data')
  const [unit, setUnit] = useState('')
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY_STORE) ?? '' } catch { return '' } })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)

  const parsed = useMemo(() => {
    if (!text.trim()) return null
    try { return detect(parseTable(text), countries, regions) } catch { return null }
  }, [text, countries, regions])

  const readFile = async (f: File) => {
    if (/\.(xlsx?|ods)$/i.test(f.name)) { setErr(ru ? 'Сохраните таблицу как CSV или вставьте ячейки прямо в поле (Ctrl+V)' : 'Save as CSV or paste cells'); return }
    setErr(null); setText(await f.text())
    if (title === 'Мои данные' || title === 'My data') setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  async function save() {
    if (!parsed) return
    setBusy(true); setErr(null)
    try { localStorage.setItem(KEY_STORE, key) } catch { /* приватный режим */ }
    const body = { title, unit: unit || undefined, kind: parsed.kind, [parsed.kind]: parsed.items, ttl_days: 365 }
    const r = await fetch('/api/v1/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) {
      setErr(r.status === 401 ? (ru ? 'Нужен действующий API-ключ' : 'Valid API key required')
        : typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.status))
      return
    }
    onSaved(j.id)
  }

  const kindName = parsed && ({ points: ru ? 'точки' : 'points', countries: ru ? 'страны' : 'countries', regions: ru ? 'регионы' : 'regions' })[parsed.kind]
  const footer = (
    <>
      <Button icon={MapPinned} testid="csv-show" disabled={!parsed?.items.length} onClick={() => parsed && onShow(parsed, title, unit)}>
        {ru ? 'Показать на карте' : 'Show on map'}
      </Button>
      <span className="flex-1" />
      <span className="relative w-44">
        <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--p-faint)]" />
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={ru ? 'API-ключ' : 'API key'}
          className={`${inputCls} h-9 pl-8`} type="password" data-testid="csv-key" />
      </span>
      <Button variant="secondary" icon={Link2} testid="csv-save" disabled={!parsed?.items.length || !key || busy} onClick={save}>
        {busy ? '…' : (ru ? 'Сохранить и получить ссылку' : 'Save & get link')}
      </Button>
    </>
  )
  return (
    <Modal theme={theme} icon={FileUp} width="max-w-2xl" testid="csv-modal" onClose={onClose} footer={footer}
      title={ru ? 'Свои данные на карту' : 'Your data on the map'}
      subtitle={ru ? 'CSV, TSV или ячейки из Excel' : 'CSV, TSV or cells from Excel'}>
      <div className="space-y-3.5">
        <p className="text-[12.5px] leading-relaxed text-[var(--p-muted)]">
          {ru ? <>Колонки: <b className="text-[var(--p-text)]">страна</b> (название или ISO3) и значение; или <b className="text-[var(--p-text)]">регион</b> (название или код RU-MOW); или <b className="text-[var(--p-text)]">широта, долгота</b> и значение. Необязательно: год, подпись.</>
            : <>Columns: <b className="text-[var(--p-text)]">country</b> (name or ISO3) and value; or <b className="text-[var(--p-text)]">region</b> (name or code RU-MOW); or <b className="text-[var(--p-text)]">lat, lon</b> and value. Optional: year, label.</>}
        </p>
        <div className={`relative rounded-xl transition ${drag ? 'ring-2 ring-[var(--p-accent)]' : ''}`}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={EXAMPLE} data-testid="csv-text"
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f) }}
            className={`${inputCls} resize-y font-mono text-[12px] leading-relaxed`} />
          {!text && <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 text-[11.5px] text-[var(--p-faint)]">
            <Upload size={13} /> {ru ? 'перетащите файл сюда' : 'drop a file here'}</div>}
        </div>
        <div className="flex items-center gap-2">
          <label className="gv-focus flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] bg-[var(--p-ctl)] px-3 text-[12.5px] font-medium hover:bg-[var(--p-ctl-hover)]">
            <FileUp size={14} className="text-[var(--p-muted)]" /> {ru ? 'Выбрать файл…' : 'Choose file…'}
            <input type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" data-testid="csv-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />
          </label>
          <button type="button" className="gv-focus h-8 rounded-[9px] px-2 text-[12.5px] font-medium text-[var(--p-accent)] hover:bg-[var(--p-accent-soft)]"
            onClick={() => setText(EXAMPLE)}>{ru ? 'Вставить пример' : 'Use example'}</button>
        </div>
        {parsed && (
          <div className={`rounded-xl px-3 py-2.5 text-[12.5px] ring-1 ${parsed.items.length > 0
            ? 'bg-emerald-500/10 ring-emerald-500/30' : 'bg-amber-500/10 ring-amber-500/30'}`} data-testid="csv-summary">
            {parsed.items.length > 0
              ? <div className="flex items-center gap-2"><CircleCheck size={15} className="shrink-0 text-emerald-500" />
                  <span>{ru ? 'Распознано' : 'Recognized'}: <b>{kindName}</b>, {parsed.items.length} {ru ? 'строк' : 'rows'}
                  {parsed.years.length > 0 && <>, {ru ? 'годы' : 'years'} {parsed.years[0]}–{parsed.years[parsed.years.length - 1]}</>}</span></div>
              : <div className="flex items-center gap-2 text-amber-500"><CircleAlert size={15} />{ru ? 'Не найдено ни одной строки с данными' : 'No data rows found'}</div>}
            {parsed.skipped > 0 && <div className="mt-1 pl-[23px] text-[var(--p-muted)]">{ru ? 'Пропущено строк без числа или координат' : 'Skipped rows'}: {parsed.skipped}</div>}
            {parsed.unmatched.length > 0 && <div className="mt-1 pl-[23px] text-amber-600" data-testid="csv-unmatched">
              {ru ? 'Не узнали' : 'Not recognized'}: {parsed.unmatched.slice(0, 12).join(', ')}{parsed.unmatched.length > 12 ? ' …' : ''}</div>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="mb-1 block text-[12px] text-[var(--p-muted)]">{ru ? 'Заголовок' : 'Title'}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} data-testid="csv-title" /></label>
          <label className="block"><span className="mb-1 block text-[12px] text-[var(--p-muted)]">{ru ? 'Единицы' : 'Unit'}</span>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={ru ? 'напр. $ млрд' : 'e.g. $ bn'} className={inputCls} data-testid="csv-unit" /></label>
        </div>
        {err && <div className="rounded-xl bg-red-500/12 px-3 py-2 text-[13px] text-red-500 ring-1 ring-red-500/30" data-testid="csv-error">{err}</div>}
      </div>
    </Modal>
  )
}
