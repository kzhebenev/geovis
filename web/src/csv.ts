/**
 * Разбор таблицы (CSV / TSV / вставка из Excel) → набор данных по контракту v1.
 * Вид определяется по колонкам: широта+долгота → points; страна → countries; регион → regions.
 * Страны и регионы можно указывать кодами (ISO 3166-1 alpha-3 / ISO 3166-2) или названиями RU/EN.
 */

export interface Table { headers: string[]; rows: string[][] }
export interface NameRef { code: string; ru: string; en: string }

export interface Parsed {
  kind: 'points' | 'countries' | 'regions'
  items: Record<string, unknown>[]      // элементы points | countries | regions контракта
  unmatched: string[]                   // нераспознанные страны/регионы (для показа пользователю)
  skipped: number                       // строки без числа/координат
  years: number[]
}

/** Разделитель: табуляция (вставка из Excel), «;» (русский Excel), иначе запятая. Кавычки — по RFC 4180. */
export function parseTable(text: string): Table {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  const first = src.split('\n', 1)[0] ?? ''
  const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  row.push(cell.trim()); rows.push(row)
  const [headers, ...body] = rows.filter((r) => r.some((c) => c !== ''))
  return { headers: (headers ?? []).map((h) => h.trim()), rows: body }
}

/** Число из ячейки: «1 234,5», «1234.5», «12%» → 1234.5 / 12; пусто или текст → null.
 *  Одна запятая — десятичная (русская запись); точка и запятая вместе или несколько запятых — запятые тысяч. */
export function num(s: string | undefined): number | null {
  if (s === undefined) return null
  let t = s.replace(/[\s\u00a0\u202f%₽$€]/g, '')
  const commas = (t.match(/,/g) ?? []).length
  t = t.includes('.') || commas > 1 ? t.replace(/,/g, '') : t.replace(',', '.')
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim()
const COLS = {
  lat: ['lat', 'latitude', 'широта', 'y'],
  lon: ['lon', 'lng', 'long', 'longitude', 'долгота', 'x'],
  country: ['iso3', 'country', 'страна', 'country code', 'код страны'],
  region: ['region', 'регион', 'code', 'код', 'subject', 'субъект', 'iso 3166 2', 'область'],
  value: ['value', 'значение', 'val', 'amount', 'сумма', 'count', 'количество'],
  year: ['year', 'год'],
  label: ['label', 'name', 'название', 'подпись', 'город', 'city', 'имя'],
}
function findCol(headers: string[], names: string[]): number {
  const h = headers.map(norm)
  for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i }
  return -1
}

/** Сопоставление названия/кода с кодом справочника (точное по коду, затем по названию RU/EN без регистра). */
export function matcher(refs: NameRef[]): (s: string) => string | null {
  const by = new Map<string, string>()
  for (const r of refs) {
    by.set(r.code.toUpperCase(), r.code)
    if (r.ru) by.set(norm(r.ru), r.code)
    if (r.en) by.set(norm(r.en), r.code)
  }
  return (s: string) => by.get(s.trim().toUpperCase()) ?? by.get(norm(s)) ?? null
}

export function detect(t: Table, countries: NameRef[], regions: NameRef[]): Parsed {
  const H = t.headers
  const iLat = findCol(H, COLS.lat), iLon = findCol(H, COLS.lon), iYear = findCol(H, COLS.year)
  const iCountry = findCol(H, COLS.country), iRegion = findCol(H, COLS.region), iLabel = findCol(H, COLS.label)
  let iVal = findCol(H, COLS.value)
  const used = new Set([iLat, iLon, iYear, iCountry, iRegion, iLabel])
  if (iVal < 0) iVal = H.findIndex((_, i) => !used.has(i) && t.rows.some((r) => num(r[i]) !== null))
  const out: Parsed = { kind: 'points', items: [], unmatched: [], skipped: 0, years: [] }
  const unmatched = new Set<string>()
  const years = new Set<number>()

  if (iLat >= 0 && iLon >= 0) {
    for (const r of t.rows) {
      const lat = num(r[iLat]), lon = num(r[iLon])
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { out.skipped++; continue }
      const v = iVal >= 0 ? num(r[iVal]) : 1
      out.items.push({ lat, lon, value: v ?? 1, ...(iLabel >= 0 && r[iLabel] ? { label: r[iLabel].slice(0, 80) } : {}) })
    }
    return out
  }
  const regionMode = iRegion >= 0 && (iCountry < 0 || t.rows.some((r) => /^[A-Za-z]{2}-/.test(r[iRegion] ?? '')))
  const keyCol = regionMode ? iRegion : (iCountry >= 0 ? iCountry : 0)
  const match = matcher(regionMode ? regions : countries)
  out.kind = regionMode ? 'regions' : 'countries'
  for (const r of t.rows) {
    const name = r[keyCol] ?? ''
    const v = iVal >= 0 ? num(r[iVal]) : null
    if (!name || v === null) { out.skipped++; continue }
    const code = match(name)
    if (!code) { unmatched.add(name); continue }
    const y = iYear >= 0 ? num(r[iYear]) : null
    if (y !== null) years.add(y)
    out.items.push({ [regionMode ? 'code' : 'iso3']: code, value: v, ...(y !== null ? { year: Math.round(y) } : {}) })
  }
  out.unmatched = [...unmatched]
  out.years = [...years].sort((a, b) => a - b)
  return out
}

/** Как в API: значения по странам/регионам → ряд (values — последний год каждой, series, общая шкала). */
export function toSeriesJson(items: Record<string, unknown>[], key: 'iso3' | 'code') {
  type It = { k: string; v: number; y: number | null }
  const its: It[] = items.map((x) => ({ k: String(x[key]), v: Number(x.value), y: typeof x.year === 'number' ? x.year : null }))
  const pack = (rows: It[]) => {
    const agg = new Map<string, number>()
    for (const r of rows) agg.set(r.k, (agg.get(r.k) ?? 0) + r.v)
    return [...agg].map(([k, v]) => ({ [key]: k, value: v })).sort((a, b) => b.value - a.value)
  }
  if (its.every((x) => x.y === null)) {
    const values = pack(its)
    return { values, max_value: values[0]?.value ?? 0, min_value: values[values.length - 1]?.value ?? 0 }
  }
  const years = [...new Set(its.map((x) => x.y!))].sort((a, b) => a - b)
  const series: Record<string, { value: number }[]> = {}
  const latest = new Map<string, { value: number; year: number }>()
  for (const y of years) {
    series[String(y)] = pack(its.filter((x) => x.y === y))
    for (const v of series[String(y)]) latest.set(String((v as Record<string, unknown>)[key]), { ...v, year: y })
  }
  const all = Object.values(series).flat().map((v) => v.value)
  return { values: [...latest].map(([k, v]) => ({ [key]: k, value: v.value, year: v.year })).sort((a, b) => b.value - a.value), years, series,
    max_value: Math.max(...all), min_value: Math.min(...all) }
}

/** Как в API: точки → сетка шага res (сумма в ячейке), NaN — пусто. */
export function pointsToGrid(points: { lat: number; lon: number; value: number }[], res = 0.25) {
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon)
  const west = Math.floor(Math.min(...lons) / res) * res - res, east = Math.ceil(Math.max(...lons) / res) * res + res
  const north = Math.min(90, Math.ceil(Math.max(...lats) / res) * res + res)
  const south = Math.max(-90, Math.floor(Math.min(...lats) / res) * res - res)
  const width = Math.max(1, Math.round((east - west) / res)), height = Math.max(1, Math.round((north - south) / res))
  const data = new Float32Array(width * height).fill(NaN)
  for (const p of points) {
    const c = Math.min(width - 1, Math.floor((p.lon - west) / res)), r = Math.min(height - 1, Math.floor((north - p.lat) / res))
    const i = r * width + c
    data[i] = (Number.isFinite(data[i]) ? data[i] : 0) + p.value
  }
  let lo = Infinity, hi = -Infinity, total = 0
  for (const v of data) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); total += v }
  return { meta: { file: 'grid.bin', res, width, height, west, north, total_population: total, min_value: lo, max_density: hi,
    p99_density: hi }, data }
}
