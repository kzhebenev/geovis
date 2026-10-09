import type { Settings } from './settings'

export interface Camera { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }

const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  mode: ['columns', 'surface'], theme: ['dark', 'light'], projection: ['globe', 'map'],
  palette: ['relief', 'inferno', 'viridis', 'neon', 'ice', 'diverge'], scale: ['log', 'sqrt', 'linear'],
  lang: ['ru', 'en'], numbers: ['none', 'population', 'density'],
}

/** Параметры ссылки/iframe → настройки и камера. Неизвестные и некорректные значения игнорируются. */
export function parseUrl(search: string): { settings: Partial<Settings>; camera?: Camera; scenario?: string; play?: boolean } {
  const q = new URLSearchParams(search)
  const s: Partial<Settings> = {}
  const id = (v: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null)
  if (id(q.get('ds'))) s.custom = id(q.get('ds'))
  if (id(q.get('dataset'))) s.dataset = id(q.get('dataset'))!
  if (id(q.get('countries'))) s.countryDataset = id(q.get('countries'))
  if (id(q.get('regions'))) s.regionDataset = id(q.get('regions'))
  if (id(q.get('compare'))) s.compareWith = id(q.get('compare'))
  // регионы: страна задана самим набором (ракурс — её), фокус-макет к ним не относится — как при выборе в окне данных
  if (id(q.get('focus'))) s.focus = s.regionDataset ? 'world' : id(q.get('focus'))!
  for (const [k, allowed] of Object.entries(ENUMS)) {
    const v = q.get(k)
    if (v && allowed!.includes(v)) (s as Record<string, unknown>)[k] = v
  }
  const smooth = Number(q.get('smooth'))
  if (q.has('smooth') && Number.isFinite(smooth) && smooth >= 0 && smooth <= 6) s.smooth = smooth
  const year = Number(q.get('year'))
  if (q.has('year') && Number.isInteger(year) && year >= 1800 && year <= 2100) s.year = year
  const sy = Number(q.get('syear'))
  if (q.has('syear') && Number.isFinite(sy) && sy >= 1800 && sy <= 2100) s.seriesYear = sy
  const res = Number(q.get('res'))
  if (q.has('res') && [1, 0.5, 0.25, 0.1, 0.05].includes(res)) s.res = res
  const height = Number(q.get('height'))
  if (q.has('height') && Number.isFinite(height) && height > 0 && height <= 10) s.height = height
  if (q.get('embed') === '1') { s.embed = true; s.showPanel = false }
  if (q.get('render') === '1') s.render = true
  if (q.get('labels') === '0') s.showCities = false
  if (q.get('legend') === '0') s.showLegend = false
  let camera: Camera | undefined
  const cam = q.get('cam')?.split(',').map(Number)
  if (cam && cam.length >= 3 && cam.every(Number.isFinite)) {
    const [longitude, latitude, zoom, pitch = 0, bearing = 0] = cam
    if (Math.abs(latitude) <= 85 && zoom >= 0 && zoom <= 12 && pitch >= 0 && pitch <= 85) {
      camera = { longitude, latitude, zoom, pitch, bearing }
    }
  }
  const scenario = id(q.get('scenario')) ?? undefined
  return { settings: s, camera, scenario, play: q.get('play') === '1' }
}
