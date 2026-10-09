import type { Lang } from './settings'

type L10n = Record<Lang, string>

/** Лицензия источника (см. DATA_SOURCES.md). restricted — некоммерческая / без производных: показываем пометку. */
export interface License { id: string; name: string; url: string; restricted: boolean; cite?: string }

export interface Level { res: number; name: string; max_density: number; min_value?: number }
export interface Dataset {
  id: string
  group: string
  group_title?: L10n
  year?: number
  title: L10n
  unit: L10n
  source: string
  agg?: 'sum' | 'mean'
  total_label?: L10n
  value_label?: L10n   // как называется значение набора на кнопке «Цифры»: «Осадки», «Температура»…
  license?: License
  country_stats?: boolean   // есть <id>/countries.json: среднее по стране (и итог для сумм) — для подписей стран
  view?: { palette?: string; scale?: string }
  levels: Level[]
  regions: Record<string, Level[]>
}
export interface CountryDataset {
  id: string; group: string; title: L10n; unit: L10n; source: string; file: string; count: number; max_value: number
  years?: [number, number]; license?: License
}
export interface RegionDataset {
  id: string; group: string; country: string; title: L10n; unit: L10n; source: string; file: string
  count: number; years?: [number, number]; max_value: number; license?: License
}
export interface Region {
  iso3: string
  title: L10n
  view: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }
  globe_view: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }
  outline: string
  extent_km?: number      // размер страны — масштаб высоты пиков
  city_min_pop?: number   // порог подписей городов (малые страны — ниже)
}
export interface Catalog { datasets: Dataset[]; country_datasets?: CountryDataset[]; region_datasets?: RegionDataset[]; regions: Region[] }

export interface Group { id: string; title: L10n; datasets: Dataset[]; countries: CountryDataset[]; regions: RegionDataset[] }

/** Группы для меню: наборы одной группы (годы/варианты) — одной карточкой. Порядок — как в каталоге. */
export function groupsOf(cat: Catalog): Group[] {
  const out: Group[] = []
  const by = new Map<string, Group>()
  for (const d of cat.datasets) {
    let g = by.get(d.group)
    if (!g) {
      g = { id: d.group, title: d.group_title ?? d.title, datasets: [], countries: [], regions: [] }
      by.set(d.group, g); out.push(g)
    }
    g.datasets.push(d)
  }
  for (const c of cat.country_datasets ?? []) {
    let g = by.get(c.group)
    if (!g) { g = { id: c.group, title: c.title, datasets: [], countries: [], regions: [] }; by.set(c.group, g); out.push(g) }
    g.countries.push(c)
  }
  for (const r of cat.region_datasets ?? []) {
    let g = by.get(r.group)
    if (!g) { g = { id: r.group, title: r.title, datasets: [], countries: [], regions: [] }; by.set(r.group, g); out.push(g) }
    g.regions.push(r)
  }
  return out
}

/** Уровни детализации для фокуса; поверхность мира — не мельче 0.25° (иначе миллионы вершин). */
export function levelsFor(ds: Dataset, focus: string, mode: 'columns' | 'surface'): Level[] {
  if (focus !== 'world') return ds.regions[focus] ?? []
  return mode === 'surface' ? ds.levels.filter((l) => l.res >= 0.25) : ds.levels
}

/** Уровень с нужным шагом, иначе ближайший доступный. */
export function pickLevel(levels: Level[], res: number): Level | undefined {
  return levels.find((l) => l.res === res) ??
    [...levels].sort((a, b) => Math.abs(a.res - res) - Math.abs(b.res - res))[0]
}

/** Высота самого высокого пика в фокусе страны, м: ~15% её размера, от 60 до 900 км. */
export function regionMaxElevation(r: Region | undefined): number {
  if (!r?.extent_km) return 900_000
  return Math.max(60_000, Math.min(900_000, r.extent_km * 1000 * 0.15))
}
