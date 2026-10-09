import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { COORDINATE_SYSTEM, MapView, _GlobeView as GlobeView, type LayersList } from '@deck.gl/core'
import { ColumnLayer, GeoJsonLayer, PathLayer, SolidPolygonLayer } from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { DEFAULT_SETTINGS, focusPreset, type PaletteId, type ScaleMode, type Settings } from './settings'
import { colorAt, divergeT, MAX_ELEVATION_M, normalize, PALETTES, type RGB } from './scale'
import { sampleDensity, toCells, type Grid, type GridMeta } from './grid'
import { cityText, countryText, countryValueText, formatCount, selectCities, type City, type Country } from './labels'
import { groupsOf, levelsFor, pickLevel, regionMaxElevation, type Catalog } from './catalog'
import { buildSurface } from './surface'
import { finiteMax, smoothGrid } from './smooth'
import { parseUrl, type Camera } from './urlstate'
import { cameraAt, captionAt, duration as scenarioDuration, settingsAt, validateScenario, type Scenario } from './scenario'
import { SCENARIOS } from './scenarios'
import { t } from './i18n'
import { SlidersHorizontal } from 'lucide-react'
import Panel from './Panel'
import Labels, { type LabelItem, type LabelsHandle } from './Labels'
import Legend from './Legend'
import VideoModal from './VideoModal'
import ScenarioHelp from './ScenarioHelp'
import CsvModal from './CsvModal'
import { pointsToGrid, toSeriesJson, type Parsed } from './csv'

const DATA = `${import.meta.env.BASE_URL}data`
const API = '/api/v1'
const METERS_PER_DEG = 111_320
const WORLD = [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]]

const THEMES = {
  dark: { bg: '#020308', mapBg: 'rgb(7,12,24)', ocean: [7, 12, 24], land: [18, 25, 40], border: [44, 56, 82],
    grid: [24, 34, 54], text: 'text-white', sub: 'text-slate-300' },
  light: { bg: '#e6edf4', mapBg: '#e6edf4', ocean: [222, 232, 241], land: [245, 248, 251], border: [176, 190, 205],
    grid: [196, 208, 221], text: 'text-slate-800', sub: 'text-slate-600' },
} as const

/** Сетка координат: меридианы −180…360 (регионы с долготами > 180°), параллели −80…80. */
const GRATICULE = (() => {
  const lines: number[][][] = []
  for (let lon = -180; lon <= 360; lon += 10) lines.push(Array.from({ length: 33 }, (_, i) => [lon, -80 + i * 5]))
  for (let lat = -80; lat <= 80; lat += 10) lines.push(Array.from({ length: 109 }, (_, i) => [-180 + i * 5, lat]))
  return lines
})()

export type ViewState = Camera

const WORLD_VIEW: Record<Settings['projection'], ViewState> = {
  globe: { longitude: 80, latitude: 22, zoom: 1.6, pitch: 0, bearing: 0 },
  map: { longitude: 80, latitude: 22, zoom: 2.6, pitch: 50, bearing: -10 },
}

interface CustomMeta {
  id: string; title: string; unit?: string; kind: 'points' | 'countries' | 'regions' | 'grid'; source?: string
  view?: Partial<Settings> & { camera?: Camera }; files: string[]
}
interface CountryValues {
  title: string; unit: string; values: Map<string, number>; max: number; min: number
  years?: number[]; series?: Map<number, Map<string, number>>   // временной ряд (общая шкала max/min на все годы)
}
interface CustomLabel { lon: number; lat: number; label: string; value: number }

declare global {
  interface Window {
    __geovis?: {
      ready: boolean
      settings: Settings
      viewState: ViewState
      grid: { name: string; total: number | null; max: number; min: number; diff: boolean; year: number | null } | null
      mesh: { vertices: number; triangles: number; walls: number } | null
      countries: { count: number; max: number; year: number | null; years: number[] | null } | null
      setSettings: (p: Partial<Settings>) => void
      setFocus: (focus: string) => void
      setDataset: (id: string) => void
      setCountryDataset: (id: string) => void
      setRegionDataset: (id: string) => void
      setViewState: (v: Partial<ViewState>) => void
      visibleLabels: () => string[]
      scenario: { id: string; time: number; duration: number; playing: boolean } | null
      playScenario: (id: string) => void
      seek: (t: number) => void
      loadScenario: (json: unknown) => void
      showTable: (text: string, title?: string, unit?: string) => Promise<{ kind: string; n: number; unmatched: string[] }>
    }
  }
}

const fromUrl = parseUrl(location.search)

export default function App() {
  // фокус на стране из ссылки — с теми же настройками, что и клик в панели (явные параметры ссылки главнее)
  const urlFocus = fromUrl.settings.focus && fromUrl.settings.focus !== 'world' && !fromUrl.settings.custom
    ? focusPreset(fromUrl.settings.focus) : {}
  // на телефоне панель сначала свёрнута (шторка закрыла бы полэкрана) — открывается кнопкой «Настройки»
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640
  const [settings, setSettingsState] = useState<Settings>({ ...DEFAULT_SETTINGS, ...(narrow ? { showPanel: false } : {}), ...urlFocus, ...fromUrl.settings })
  const set = (p: Partial<Settings>) => setSettingsState((s) => ({ ...s, ...p }))
  const [viewState, setViewState] = useState<ViewState>(fromUrl.camera ?? WORLD_VIEW[settings.projection])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [grids, setGrids] = useState<Record<string, Grid>>({})
  const [countryData, setCountryData] = useState<Record<string, CountryValues>>({})
  const [custom, setCustom] = useState<CustomMeta | null>(null)
  const [customLabels, setCustomLabels] = useState<CustomLabel[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [countries, setCountries] = useState<Country[]>([])
  const [outlines, setOutlines] = useState<{ features: { properties: { ADM0_A3: string } }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const deckRef = useRef<any>(null)
  const labelsRef = useRef<LabelsHandle>(null)
  // сценарий полёта
  const [customScenario, setCustomScenario] = useState<Scenario | null>(null)
  const [scenario, setScenario] = useState<Scenario | null>(SCENARIOS.find((x) => x.id === fromUrl.scenario) ?? null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [videoOpen, setVideoOpen] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [admin1Refs, setAdmin1Refs] = useState<{ code: string; ru: string; en: string }[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const applied = useRef('')
  const readyRef = useRef(false)
  const timeRef = useRef(0)
  // актуальный сценарий для внешних вызовов (__geovis.seek сразу после playScenario — без ожидания рендера)
  const scenarioRef = useRef<Scenario | null>(scenario)
  const useScenario = (sc: Scenario | null) => { scenarioRef.current = sc; setScenario(sc) }

  useEffect(() => {
    Promise.all([
      fetch(`${DATA}/catalog.json`).then((r) => r.json()),
      fetch(`${DATA}/cities.json`).then((r) => r.json()),
      fetch(`${DATA}/countries.json`).then((r) => r.json()),
      // запись видео и снимки — упрощённые границы (основная цена кадра без видеокарты)
      fetch(`${DATA}/${fromUrl.settings.render || fromUrl.settings.embed ? 'outlines_lo' : 'outlines'}.geojson`).then((r) => r.json()),
    ]).then(([cat, ci, co, ol]) => {
      setCatalog(cat); setCities(ci); setCountries(co); setOutlines(ol)
      // набор по ссылке — с его палитрой/шкалой по умолчанию, если ссылка их не задала
      const u = fromUrl.settings
      const hint: Partial<Settings> = {}
      const d = (cat as Catalog).datasets.find((x) => x.id === u.dataset)
      const rdUrl = (cat as Catalog).region_datasets?.find((x) => x.id === u.regionDataset)
      if (u.countryDataset) { hint.palette = 'viridis'; hint.scale = 'sqrt' }
      else if (rdUrl) {
        // регионы по ссылке — как при выборе в окне данных: карта, ракурс страны, viridis, корень
        hint.palette = 'viridis'; hint.scale = 'sqrt'
        if (!u.projection) hint.projection = 'map'
        const rr = (cat as Catalog).regions.find((x) => x.iso3 === rdUrl.country)
        if (rr && !fromUrl.camera) setViewState((u.projection ?? 'map') === 'map' ? rr.view : rr.globe_view)
      }
      else if (u.focus && u.focus !== 'world') { /* фокус на стране: палитра и шкала макета (focusPreset) главнее подсказок набора */ }
      else if (d?.view) {
        if (d.view.palette) hint.palette = d.view.palette as PaletteId
        if (d.view.scale) hint.scale = d.view.scale as ScaleMode
      }
      if (u.palette) delete hint.palette
      if (u.scale) delete hint.scale
      if (!u.custom && Object.keys(hint).length) set(hint)
      // ссылка с фокусом на страну без камеры — ракурс региона
      const f = fromUrl.settings.focus
      if (f && f !== 'world' && !fromUrl.camera) {
        const r = (cat as Catalog).regions.find((x) => x.iso3 === f)
        if (r) {
          setViewState((fromUrl.settings.projection ?? 'map') === 'map' ? r.view : r.globe_view)
          if (r.city_min_pop && fromUrl.settings.cityMinPop === undefined) set({ cityMinPop: r.city_min_pop })
        }
      }
    }).catch((e) => setError(String(e)))
  }, [])

  // пользовательский набор из API (?ds=)
  useEffect(() => {
    if (!settings.custom) { setCustom(null); setCustomLabels([]); return }
    if (settings.custom === 'local') return   // данные из таблицы — уже в памяти (showLocal)
    const base = `${API}/datasets/${settings.custom}`
    fetch(base).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 404 ? `набор ${settings.custom} не найден` : `API: ${r.status}`)
      const m: CustomMeta = await r.json()
      setCustom(m)
      const v = m.view ?? {}
      // подсказки вида из набора — если ссылка их не переопределила
      const hint: Partial<Settings> = {}
      for (const k of ['mode', 'theme', 'projection', 'palette', 'scale', 'smooth'] as const) {
        if (v[k] !== undefined && fromUrl.settings[k] === undefined) (hint as Record<string, unknown>)[k] = v[k]
      }
      set({ ...hint, focus: 'world', countryDataset: null })
      if (v.camera && !fromUrl.camera) setViewState(v.camera)
      else if (!fromUrl.camera && (hint.projection ?? settings.projection) === 'map') setViewState(WORLD_VIEW.map)
      if (m.files.includes('labels.json')) setCustomLabels(await (await fetch(`${base}/files/labels.json`)).json())
      if (m.kind === 'countries' || m.kind === 'regions') {
        const cv = await (await fetch(`${base}/files/${m.kind}.json`)).json()
        setCountryData((d) => ({ ...d, [`custom/${m.id}`]: toCountryValues(cv, m.title, m.unit ?? '') }))
      }
    }).catch((e) => setError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.custom])

  const groups = useMemo(() => (catalog ? groupsOf(catalog) : []), [catalog])
  const baseDataset = catalog?.datasets.find((d) => d.id === settings.dataset) ?? catalog?.datasets[0]
  // плавный год серии: две соседние эпохи (A ≤ год ≤ B) той же группы и единиц, смесь по доле f
  const series = useMemo(() => {
    if (settings.seriesYear === null || !catalog || !baseDataset || baseDataset.year === undefined) return null
    const peers = catalog.datasets.filter((d) => d.group === baseDataset.group && d.unit.ru === baseDataset.unit.ru
      && d.year !== undefined).sort((a, b) => a.year! - b.year!)
    if (peers.length < 2) return null
    const y = Math.max(peers[0].year!, Math.min(peers[peers.length - 1].year!, settings.seriesYear))
    const A = [...peers].reverse().find((d) => d.year! <= y)!
    const B = peers.find((d) => d.year! >= y)!
    return { A, B, year: y, f: B.year === A.year ? 0 : (y - A.year!) / (B.year! - A.year!) }
  }, [settings.seriesYear, catalog, baseDataset])
  const dataset = series ? series.A : baseDataset
  const countryDs = catalog?.country_datasets?.find((c) => c.id === settings.countryDataset)
  const regionDs = !settings.countryDataset ? catalog?.region_datasets?.find((r) => r.id === settings.regionDataset) : undefined
  const region = catalog?.regions.find((r) => r.iso3 === settings.focus)
  const isCustom = Boolean(settings.custom)

  // что рисуем: сетка (встроенная или своя) либо страны
  // «области» на карте: страны (ключ ADM0_A3) или регионы стран (ключ ISO 3166-2)
  const countryKey = isCustom ? (custom?.kind === 'countries' || custom?.kind === 'regions' ? `custom/${custom.id}` : null)
    : countryDs ? countryDs.id : regionDs ? `region/${regionDs.id}` : null
  const areaKind: 'countries' | 'regions' | null = !countryKey ? null
    : (isCustom ? custom?.kind === 'regions' : Boolean(regionDs)) ? 'regions' : 'countries'
  const levels = dataset && !isCustom && !countryKey ? levelsFor(dataset, settings.focus, settings.mode) : []
  const level = pickLevel(levels, settings.res)
  const gridUrl = isCustom
    ? (custom && custom.kind !== 'countries' && custom.kind !== 'regions' ? `${API}/datasets/${custom.id}/files/grid.json` : null)
    : (!countryKey && dataset && level ? `${DATA}/${dataset.id}/${level.name}.json` : null)

  const blendUrl = series && level && series.f > 0 ? `${DATA}/${series.B.id}/${level.name}.json` : null
  const compareDs = !isCustom && !countryKey && dataset && settings.compareWith && settings.compareWith !== dataset.id
    ? catalog?.datasets.find((d) => d.id === settings.compareWith && d.unit.ru === dataset.unit.ru) : undefined
  const compareUrl = compareDs && level && [...compareDs.levels, ...Object.values(compareDs.regions).flat()].some((l) => l.name === level.name)
    ? `${DATA}/${compareDs.id}/${level.name}.json` : null

  useEffect(() => {
    for (const u of [blendUrl, compareUrl]) {
      if (!u || grids[u]) continue
      ;(async () => {
        const r = await fetch(u)
        if (!r.ok) throw new Error(`${u}: ${r.status}`)
        const meta: GridMeta = await r.json()
        const data = new Float32Array(await (await fetch(u.replace(/[^/]+$/, meta.file))).arrayBuffer())
        setGrids((m) => ({ ...m, [u]: { name: u, meta, data } }))
      })().catch((e) => setError(String(e)))
    }
  }, [blendUrl, compareUrl, grids])

  useEffect(() => {
    if (!gridUrl || grids[gridUrl]) return
    ;(async () => {
      const r = await fetch(gridUrl)
      if (!r.ok) throw new Error(`${gridUrl}: ${r.status}`)
      const meta: GridMeta = await r.json()
      const buf = await (await fetch(gridUrl.replace(/[^/]+$/, meta.file))).arrayBuffer()
      const data = new Float32Array(buf)
      if (data.length !== meta.width * meta.height) throw new Error(`${gridUrl}: размер ${data.length}`)
      setGrids((m) => ({ ...m, [gridUrl]: { name: gridUrl, meta, data } }))
    })().catch((e) => setError(String(e)))
  }, [gridUrl, grids])

  useEffect(() => {
    if (!countryDs || countryData[countryDs.id]) return
    fetch(`${DATA}/${countryDs.file}`).then((r) => r.json())
      .then((j) => setCountryData((d) => ({ ...d, [countryDs.id]: toCountryValues(j, countryDs.title[settings.lang], countryDs.unit[settings.lang]) })))
      .catch((e) => setError(String(e)))
  }, [countryDs, countryData, settings.lang])

  useEffect(() => {
    if (!regionDs || countryData[`region/${regionDs.id}`]) return
    fetch(`${DATA}/${regionDs.file}`).then((r) => r.json())
      .then((j) => setCountryData((d) => ({ ...d, [`region/${regionDs.id}`]: toCountryValues(j, regionDs.title[settings.lang], regionDs.unit[settings.lang]) })))
      .catch((e) => setError(String(e)))
  }, [regionDs, countryData, settings.lang])

  // границы регионов и точки подписей — лениво, только когда нужны (~900 КБ)
  const [admin1, setAdmin1] = useState<{ geo: object; labels: Map<string, { ru: string; en: string; lon: number; lat: number }> } | null>(null)
  useEffect(() => {
    if (areaKind !== 'regions' || admin1) return
    Promise.all([fetch(`${DATA}/admin1.geojson`).then((r) => r.json()), fetch(`${DATA}/admin1_labels.json`).then((r) => r.json())])
      .then(([geo, lb]) => setAdmin1({ geo, labels: new Map(lb.map((x: { code: string }) => [x.code, x])) }))
      .catch((e) => setError(String(e)))
  }, [areaKind, admin1])

  const gridA = gridUrl ? grids[gridUrl] : undefined
  const gridB = blendUrl ? grids[blendUrl] : undefined
  const gridC = compareUrl ? grids[compareUrl] : undefined
  const blended = useMemo<Grid | undefined>(() => {
    if (!gridA || !series || series.f === 0) return gridA
    if (!gridB || gridB.data.length !== gridA.data.length) return undefined
    const f = series.f, a = gridA.data, b = gridB.data, out = new Float32Array(a.length)
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i]
      out[i] = Number.isFinite(x) ? (Number.isFinite(y) ? x + (y - x) * f : x) : y
    }
    const ta = gridA.meta.total_population, tb = gridB.meta.total_population
    return { name: `${gridA.name}~${gridB.name}@${f.toFixed(4)}`, data: out,
      meta: { ...gridA.meta, max_density: finiteMax(out),
        total_population: ta !== null && tb !== null ? ta + (tb - ta) * f : null } }
  }, [gridA, gridB, series])
  const diffMode = Boolean(compareUrl)
  const grid = useMemo<Grid | undefined>(() => {
    if (!blended || !compareUrl) return blended
    if (!gridC || gridC.data.length !== blended.data.length) return undefined
    const a = blended.data, c = gridC.data, out = new Float32Array(a.length)
    let lo = 0, hi = 0
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = c[i]
      const v = (Number.isFinite(x) ? x : 0) - (Number.isFinite(y) ? y : 0)
      out[i] = !Number.isFinite(x) && !Number.isFinite(y) ? NaN : v === 0 ? NaN : v   // без изменений — пусто
      if (out[i] < lo) lo = out[i]
      if (out[i] > hi) hi = out[i]
    }
    const ta = blended.meta.total_population, tc = gridC.meta.total_population
    return { name: `${blended.name}-${gridC.name}`, data: out,
      meta: { ...blended.meta, min_value: lo, max_density: hi, total_population: ta !== null && tc !== null ? ta - tc : null } }
  }, [blended, gridC, compareUrl])
  const cvalsAll = countryKey ? countryData[countryKey] : undefined
  // год ряда: выбранный, иначе последний; шкала (max/min) общая на все годы
  const cyear = cvalsAll?.years ? (settings.year && cvalsAll.series!.has(settings.year)
    ? settings.year : cvalsAll.years[cvalsAll.years.length - 1]) : null
  const cvals = useMemo<CountryValues | undefined>(() => (cvalsAll && cyear !== null
    ? { ...cvalsAll, values: cvalsAll.series!.get(cyear)! } : cvalsAll), [cvalsAll, cyear])
  const isRegion = settings.focus !== 'world' && !isCustom && !countryKey
  const theme = THEMES[settings.theme]
  const maxElev = (isRegion ? regionMaxElevation(region) : MAX_ELEVATION_M) * settings.height
  const base = isRegion ? maxElev * 0.02 : 0
  const unit = isCustom ? (custom?.unit ?? '') : countryKey ? (cvals?.unit ?? '') : (dataset?.unit[settings.lang] ?? '')

  // форма — из сглаженной сетки (если включено), цифры подписей — из исходной
  const shape = useMemo<Grid | undefined>(() => {
    if (!grid || settings.smooth <= 0) return grid
    const data = smoothGrid(grid.data, grid.meta.width, grid.meta.height, settings.smooth)
    return { name: `${grid.name}~${settings.smooth}`, meta: { ...grid.meta, max_density: finiteMax(data) }, data }
  }, [grid, settings.smooth])

  const vmin = shape?.meta.min_value ?? 0
  // серия наборов (эпохи населения 1975…2030) — общая шкала, иначе рост не виден:
  // каждая эпоха, нормированная по своему максимуму, выглядит одинаково «горячей»
  const normMax = useMemo(() => {
    if (!shape || !grid) return 1
    const own = shape.meta.max_density
    if (!catalog || !dataset || !level || isCustom) return own
    const peers = catalog.datasets.filter((d) => d.group === dataset.group && d.unit.ru === dataset.unit.ru)
    if (peers.length < 2) return own
    const peerMax = Math.max(...peers.map((d) =>
      [...d.levels, ...Object.values(d.regions).flat()].find((l) => l.name === level.name)?.max_density ?? 0))
    return peerMax * (own / (grid.meta.max_density || own))   // поправка на сглаживание
  }, [shape, grid, catalog, dataset, level, isCustom])
  // разница: высота — модуль изменения, цвет — расходящаяся палитра (убыль синим, рост красным)
  const maxAbs = shape ? Math.max(Math.abs(shape.meta.min_value ?? 0), Math.abs(shape.meta.max_density)) : 1
  const heightOf = (d: number) => (!shape ? 0 : diffMode
    ? normalize(Math.abs(d), maxAbs, settings.scale) * maxElev : normalize(d, normMax, settings.scale, vmin) * maxElev)
  const colorOf = (d: number): RGB => (diffMode ? colorAt(divergeT(d, maxAbs, settings.scale), PALETTES.diverge)
    : colorAt(shape ? normalize(d, normMax, settings.scale, vmin) : 0, PALETTES[settings.palette]))

  const cells = useMemo(() => (shape && settings.mode === 'columns' ? toCells(shape, vmin < 0 || diffMode ? -Infinity : 0) : null),
    [shape, settings.mode, vmin, diffMode])

  const columns = useMemo(() => {
    if (!shape || !cells) return null
    const positions = new Float32Array(cells.n * 2)
    const elevations = new Float32Array(cells.n)
    const colors = new Uint8Array(cells.n * 3)
    for (let i = 0; i < cells.n; i++) {
      const c = colorOf(cells.density[i])
      positions[i * 2] = cells.lon[i]
      positions[i * 2 + 1] = cells.lat[i]
      elevations[i] = heightOf(cells.density[i])
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2]
    }
    return { n: cells.n, positions, elevations, colors }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, cells, settings.palette, settings.scale, settings.height, isRegion, normMax])

  const mesh = useMemo(() => {
    if (!shape || settings.mode !== 'surface') return null
    const pal = PALETTES[settings.palette]
    const wall = pal[0].map((v) => v * 0.72) as unknown as RGB
    const m = buildSurface(shape, {
      height: heightOf, color: colorOf, base,
      wallColor: isRegion ? wall : null, skipZeroTriangles: !isRegion && vmin >= 0,
    })
    return {
      stats: { vertices: m.vertexCount, triangles: m.triangleCount, walls: m.wallQuads },
      mesh: {
        attributes: { POSITION: { value: m.positions, size: 3 }, COLOR_0: { value: m.colors, size: 3 } },
        indices: { value: m.indices, size: 1 },
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, settings.mode, settings.palette, settings.scale, settings.height, isRegion, normMax])

  const elevationAt = (lon: number, lat: number) => {
    if (!shape) return 0
    const d = sampleDensity(shape, lon, lat)
    return Number.isFinite(d) ? base + heightOf(d) : 0
  }

  // картограмма стран: высота и цвет страны по значению
  const countryMaxElev = MAX_ELEVATION_M * settings.height
  const countryNorm = (v: number | undefined) =>
    v === undefined || !cvals ? 0 : normalize(v, cvals.max, settings.scale, Math.min(0, cvals.min))

  const cityLabels = useMemo(
    () => (settings.showCities && !countryKey && !(isCustom && customLabels.length)
      ? selectCities(cities, settings.cityMinPop, settings.cityLimit, isRegion ? settings.focus : 'world') : []),
    [cities, settings.showCities, settings.cityMinPop, settings.cityLimit, settings.focus, countryKey, isCustom, customLabels, isRegion],
  )
  // значения наборов по странам (среднее по площади) — подписи стран показывают ТЕКУЩИЙ набор, а не плотность населения
  const [cstats, setCstats] = useState<Record<string, Record<string, [number, number | null]>>>({})
  const statIds = [dataset, series && series.f > 0 ? series.B : null, diffMode ? compareDs : null]
    .filter((d) => d?.country_stats).map((d) => d!.id)
  useEffect(() => {
    if (!settings.showCountries) return
    for (const id of statIds) {
      if (cstats[id]) continue
      fetch(`${DATA}/${id}/countries.json`).then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j?.values) setCstats((s) => ({ ...s, [id]: j.values })) }).catch(() => { /* без чисел у стран */ })
    }
  }, [statIds.join(','), settings.showCountries]) // eslint-disable-line react-hooks/exhaustive-deps
  // k: 0 — среднее по стране (в единицах набора), 1 — итог (для наборов-сумм: население страны в год набора)
  const countryStat = (iso: string, k: 0 | 1 = 0): number | null => {
    if (isCustom || countryKey || !dataset?.country_stats) return null   // свои данные — без чужих чисел
    const at = (id: string) => { const x = cstats[id]?.[iso]?.[k]; return x === null ? undefined : x }
    let v = at(dataset.id)
    if (v === undefined) return null
    if (series && series.f > 0) { const b = at(series.B.id); if (b === undefined) return null; v += (b - v) * series.f }
    if (diffMode && compareDs) { const c = at(compareDs.id); if (c === undefined) return null; v -= c }
    return v
  }

  // год набора далёк от нашего — население городов в подписях только современное (отмечаем «сейчас»)
  const shownYear = series ? series.year : dataset?.year
  const cityPopIsNow = !isCustom && !countryKey && shownYear !== undefined && Math.abs(shownYear - new Date().getFullYear()) > 5

  const countryLabels = useMemo(
    () => (settings.showCountries && !isRegion && !countryKey ? countries.filter((c) => c.min_label <= 4 && c.pop > 0) : []),
    [countries, settings.showCountries, isRegion, countryKey],
  )

  // долготы точек региона за антимеридианом (Чукотка) — в развёрнутый диапазон сетки
  const unwrapLon = (lon: number) => (grid && grid.meta.west > 0 && lon < grid.meta.west - 180 ? lon + 360 : lon)

  const labelItems = useMemo<LabelItem[]>(() => {
    const items: LabelItem[] = []
    if (cvals && settings.showCities) {
      const byIso: Map<string, { ru: string; en: string; lon: number; lat: number }> = areaKind === 'regions'
        ? (admin1?.labels ?? new Map()) : new Map(countries.map((c) => [c.iso3, c]))
      ;[...cvals.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, settings.cityLimit).forEach(([iso, v]) => {
        const c = byIso.get(iso)
        if (!c) return
        items.push({ key: `cv-${iso}`, lon: c.lon, lat: c.lat, kind: 'city', priority: Math.log10(Math.abs(v) + 1),
          z: countryNorm(v) * countryMaxElev + 20_000, ...countryValueText(c as never, v, settings.lang, cvals.unit) })
      })
      return items
    }
    if (isCustom && customLabels.length && settings.showCities) {
      customLabels.slice(0, settings.cityLimit).forEach((l, i) => items.push({
        key: `cl-${i}`, lon: l.lon, lat: l.lat, kind: 'city', priority: Math.log10(Math.abs(l.value) + 1),
        z: elevationAt(l.lon, l.lat) + 20_000, title: l.label, sub: `${formatCount(l.value, settings.lang)} ${unit}`.trim(),
      }))
      return items
    }
    for (const c of countryLabels) {
      items.push({ key: `co-${c.iso3}`, lon: c.lon, lat: c.lat, z: 0, kind: 'country',
        priority: Math.log10(1 + c.pop) - 10, ...countryText(c, settings.lang, settings.numbers, countryStat(c.iso3), unit, diffMode,
          dataset?.group === 'pop' ? countryStat(c.iso3, 1) : null) })
    }
    for (const c of cityLabels) {
      const lon = unwrapLon(c.lon)
      const val = grid ? sampleDensity(grid, lon, c.lat) : 0
      items.push({ key: `ci-${c.en}-${c.lon}`, lon, lat: c.lat, kind: 'city',
        z: elevationAt(lon, c.lat) + 20_000, priority: Math.log10(c.pop),
        ...cityText(c, settings.lang, settings.numbers, Number.isFinite(val) ? val : 0, unit, cityPopIsNow),
        ...(diffMode && settings.numbers === 'density' && Number.isFinite(val)
          ? { sub: `${val > 0 ? '+' : ''}${formatCount(val, settings.lang)} ${unit}` } : {}) })
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryLabels, cityLabels, cvals, customLabels, countries, admin1, areaKind, settings.lang, settings.numbers, settings.scale,
    settings.height, settings.cityLimit, settings.showCities, grid, shape, unit, diffMode, cityPopIsNow, cstats, series?.f, compareDs?.id, dataset?.id])

  const isGlobe = settings.projection === 'globe'
  const view = isGlobe
    ? new GlobeView({ id: 'globe', controller: true, resolution: 5 })
    : new MapView({ id: 'map', controller: true, repeat: false })

  const cellMeters = grid ? grid.meta.res * METERS_PER_DEG : 0
  const material = { ambient: 0.5, diffuse: 0.65, shininess: 24, specularColor: [50, 50, 50] as [number, number, number] }
  const pal = PALETTES[settings.palette]

  const layers: LayersList = [
    new SolidPolygonLayer({ id: 'ocean', data: WORLD, getPolygon: (d) => d, getFillColor: [...theme.ocean],
      updateTriggers: { getFillColor: settings.theme } }),
    settings.theme === 'light' && new PathLayer({
      id: 'graticule', data: GRATICULE, getPath: (d) => d, getColor: [...theme.grid], widthMinPixels: 0.6,
    }),
    outlines && (!cvals || areaKind === 'regions') && new GeoJsonLayer({
      id: 'land', data: outlines as never, filled: true, stroked: true,
      getFillColor: isRegion ? [...theme.ocean] : [...theme.land],
      getLineColor: isRegion ? [...theme.border, 90] : [...theme.border], lineWidthMinPixels: 0.6,
      updateTriggers: { getFillColor: [settings.theme, isRegion], getLineColor: [settings.theme, isRegion] },
    }),
    cvals && (areaKind === 'regions' ? admin1 : outlines) && new GeoJsonLayer({
      id: `choropleth-${countryKey}`, data: (areaKind === 'regions' ? admin1!.geo : outlines) as never,
      filled: true, stroked: true, extruded: true,
      getElevation: (f: any) => countryNorm(cvals.values.get(f.properties.ADM0_A3 ?? f.properties.code)) * countryMaxElev,
      getFillColor: (f: any) => {
        const v = cvals.values.get(f.properties.ADM0_A3 ?? f.properties.code)
        return v === undefined ? [...theme.land] : [...colorAt(countryNorm(v), pal)] as [number, number, number]
      },
      getLineColor: [...theme.border], lineWidthMinPixels: 0.5, material,
      updateTriggers: { getElevation: [settings.scale, settings.height, cyear], getFillColor: [settings.palette, settings.scale, settings.theme, cyear] },
    }),
    columns && new ColumnLayer({
      id: 'columns',
      data: {
        length: columns.n,
        attributes: {
          getPosition: { value: columns.positions, size: 2 },
          getElevation: { value: columns.elevations, size: 1 },
          getFillColor: { value: columns.colors, size: 3, normalized: true },
        },
      } as never,
      diskResolution: 4, angle: 45, radius: cellMeters / Math.SQRT2, coverage: 0.9,
      extruded: true, elevationScale: 1, material,
    }),
    mesh && new SimpleMeshLayer({
      id: `surface-${gridUrl}`, data: [0], mesh: mesh.mesh as never, _instanced: false,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT, getPosition: () => [0, 0, 0], getColor: [255, 255, 255],
      material: { ambient: 0.55, diffuse: 0.7, shininess: 16, specularColor: [40, 40, 40] },
    }),
  ]

  function regionView(iso: string, projection: Settings['projection']): ViewState {
    const r = catalog?.regions.find((x) => x.iso3 === iso)
    if (!r) return WORLD_VIEW[projection]
    return projection === 'map' ? r.view : r.globe_view
  }

  function chooseFocus(focus: string) {
    const p = focusPreset(focus)
    const r = catalog?.regions.find((x) => x.iso3 === focus)
    if (r?.city_min_pop) p.cityMinPop = r.city_min_pop
    set({ ...p, countryDataset: null, custom: null })
    setViewState(focus === 'world' ? WORLD_VIEW[p.projection!] : regionView(focus, p.projection!))
  }

  function chooseDataset(id: string) {
    const d = catalog?.datasets.find((x) => x.id === id)
    const hint: Partial<Settings> = {}
    if (d?.view?.palette) hint.palette = d.view.palette as PaletteId
    if (d?.view?.scale) hint.scale = d.view.scale as ScaleMode
    const cmp = catalog?.datasets.find((x) => x.id === settings.compareWith)
    set({ dataset: id, countryDataset: null, regionDataset: null, custom: null, seriesYear: null,
      compareWith: cmp && d && cmp.unit.ru === d.unit.ru && cmp.id !== id ? cmp.id : null, ...hint })
  }

  /** Данные из таблицы (окно «Свои данные») — на карту без сервера: те же расчёты, что в API. */
  function showLocal(p: Parsed, title: string, unitIn: string) {
    const meta: CustomMeta = { id: 'local', title, unit: unitIn, kind: p.kind, view: {}, files: [],
      source: settings.lang === 'ru' ? 'данные из таблицы' : 'table data' }
    setError(null); setCustom(meta)
    if (p.kind === 'points') {
      const pts = p.items as { lat: number; lon: number; value: number; label?: string }[]
      const g = pointsToGrid(pts, 0.25)
      const url = `${API}/datasets/local/files/grid.json`
      setGrids((m) => ({ ...m, [url]: { name: `${url}#${Date.now()}`, meta: g.meta as GridMeta, data: g.data } }))
      setCustomLabels(pts.filter((x) => x.label).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 300)
        .map((x) => ({ lon: x.lon, lat: x.lat, label: x.label!, value: x.value })))
      const lons = pts.map((x) => x.lon), lats = pts.map((x) => x.lat)
      const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats), 2)
      setViewState({ longitude: (Math.min(...lons) + Math.max(...lons)) / 2, latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
        zoom: Math.max(1, Math.min(7, Math.log2(400 / span))), pitch: 40, bearing: 0 })
    } else {
      setCustomLabels([])
      const key = p.kind === 'regions' ? 'code' : 'iso3'
      setCountryData((d) => ({ ...d, 'custom/local': toCountryValues(toSeriesJson(p.items, key) as never, title, unitIn) }))
      const prefix = p.kind === 'regions' ? String(p.items[0]?.code ?? '').slice(0, 2) : ''
      const iso = { RU: 'RUS', KZ: 'KAZ', BY: 'BLR', KG: 'KGZ', AM: 'ARM', UZ: 'UZB', TJ: 'TJK' }[prefix]
      setViewState(iso ? regionView(iso, 'map') : WORLD_VIEW.map)
    }
    set({ custom: 'local', countryDataset: null, regionDataset: null, compareWith: null, seriesYear: null, focus: 'world',
      projection: 'map', palette: 'viridis', scale: 'sqrt', year: null })
    setCsvOpen(false)
  }

  function openCsv() {
    setCsvOpen(true)
    if (!admin1Refs.length) fetch(`${DATA}/admin1_labels.json`).then((r) => r.json()).then(setAdmin1Refs).catch(() => {})
  }

  function chooseRegionDataset(id: string) {
    const r = catalog?.region_datasets?.find((x) => x.id === id)
    set({ regionDataset: id, countryDataset: null, custom: null, focus: 'world', scale: 'sqrt', palette: 'viridis', projection: 'map', year: null })
    if (r) setViewState(regionView(r.country, 'map'))
  }

  function chooseCountryDataset(id: string) {
    set({ countryDataset: id, regionDataset: null, custom: null, focus: 'world', scale: 'sqrt', palette: 'viridis', year: null })
    if (isRegion) setViewState(WORLD_VIEW[settings.projection])
  }

  const switchProjection = (projection: Settings['projection']) => {
    set({ projection })
    setViewState(isRegion ? regionView(settings.focus, projection) : WORLD_VIEW[projection])
  }

  // --- сценарий: время → камера и сцена (одинаковое t — одинаковый кадр) ---
  function applyAt(sc: Scenario, t: number) {
    timeRef.current = t
    setViewState(cameraAt(sc, t))
    const st = settingsAt(sc, t)
    const key = JSON.stringify(st)
    if (key !== applied.current) { applied.current = key; set(st) }
    setTime(t)
  }

  function pickScenario(id: string) {
    const sc = id === 'custom' ? customScenario : SCENARIOS.find((x) => x.id === id) ?? null
    if (!sc) return
    setPlaying(false); useScenario(sc); applied.current = ''; applyAt(sc, 0)
  }

  useEffect(() => {
    if (!playing || !scenario) return
    const dur = scenarioDuration(scenario)
    // время копится по кадрам: шаг = реальная длительность кадра, но не больше 100 мс —
    // долгий кадр (загрузка набора, тяжёлая перерисовка) притормаживает полёт, а не перескакивает
    let t = timeRef.current
    let last = 0
    let raf = 0
    const tick = (now: number) => {
      if (last && readyRef.current) t = Math.min(dur, t + Math.min(now - last, 100) / 1000)
      last = now
      applyAt(scenario, t)
      if (t >= dur) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, scenario])

  // ссылка ?scenario=<id>&play=1 — запуск после загрузки каталога
  useEffect(() => {
    if (!catalog || !fromUrl.scenario || !scenario) return
    applied.current = ''; applyAt(scenario, 0)
    if (fromUrl.play) setPlaying(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])

  function addKeyframe() {
    const snap: Partial<Settings> = {
      dataset: settings.dataset, countryDataset: settings.countryDataset, focus: settings.focus, res: settings.res,
      mode: settings.mode, theme: settings.theme, projection: settings.projection, palette: settings.palette,
      scale: settings.scale, smooth: settings.smooth, height: settings.height,
    }
    const base = customScenario ?? { id: 'custom', title: { ru: 'Свой сценарий', en: 'Custom scenario' }, keyframes: [] }
    const last = base.keyframes[base.keyframes.length - 1]
    const next: Scenario = { ...base, keyframes: [...base.keyframes,
      { t: last ? last.t + 5 : 0, camera: { ...viewState }, settings: snap }] }
    setCustomScenario(next); useScenario(next); timeRef.current = next.keyframes[next.keyframes.length - 1].t
    setTime(timeRef.current)
  }

  function exportScenario() {
    if (!scenario) return
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `geovis-${scenario.id}.json`; a.click()
    URL.revokeObjectURL(a.href)
  }

  function importScenario(json: unknown) {
    try {
      const sc = { ...validateScenario(typeof json === 'string' ? JSON.parse(json) : json), id: 'custom' }
      setCustomScenario(sc); useScenario(sc); setPlaying(false); applied.current = ''; applyAt(sc, 0); setError(null)
    } catch (e) {
      setError(`${t(settings.lang, 'importError')}: ${(e as Error).message}`)
    }
  }

  const caption = scenario ? captionAt(scenario, time) : null
  const captionOpacity = caption ? Math.min(1, (time - caption.since) / 0.6) : 0

  const sceneReady = Boolean(outlines && ((grid && (columns || mesh)) || (cvals && (areaKind !== 'regions' || admin1))))
  readyRef.current = sceneReady

  // хук для автотестов и будущего рендера видео
  useEffect(() => {
    window.__geovis = {
      ready: sceneReady,
      settings, viewState,
      grid: grid ? { name: grid.name, total: grid.meta.total_population ?? null, max: grid.meta.max_density,
        min: grid.meta.min_value ?? 0, diff: diffMode, year: series ? series.year : (dataset?.year ?? null) } : null,
      mesh: mesh?.stats ?? null,
      countries: cvals ? { count: cvals.values.size, max: cvals.max, year: cyear, years: cvalsAll?.years ?? null } : null,
      setSettings: set,
      setFocus: chooseFocus,
      setDataset: chooseDataset,
      setCountryDataset: chooseCountryDataset,
      setRegionDataset: chooseRegionDataset,
      setViewState: (v) => setViewState((s) => ({ ...s, ...v })),
      visibleLabels: () => labelsRef.current?.visible() ?? [],
      scenario: scenario ? { id: scenario.id, time, duration: scenarioDuration(scenario), playing } : null,
      playScenario: (id) => { pickScenario(id); setPlaying(true) },
      seek: (tt) => { const sc = scenarioRef.current; if (sc) { setPlaying(false); applyAt(sc, tt) } },
      loadScenario: importScenario,
      showTable: (text: string, title = 'table', unitIn = '') => import('./csv').then(({ detect, parseTable }) => {
        const p = detect(parseTable(text), countries.map((c) => ({ code: c.iso3, ru: c.ru, en: c.en })), admin1Refs)
        showLocal(p, title, unitIn); return { kind: p.kind, n: p.items.length, unmatched: p.unmatched }
      }),
    }
  })

  useEffect(() => {
    const relayout = () => requestAnimationFrame(() =>
      labelsRef.current?.update(deckRef.current?.deck?.getViewports()[0], isGlobe))
    relayout()
    window.addEventListener('resize', relayout)
    return () => window.removeEventListener('resize', relayout)
  }, [labelItems, isGlobe])

  // H — спрятать панель (чистый кадр для записи)
  useEffect(() => {
    if (settings.embed) return
    const onKey = (e: KeyboardEvent) => {
      if (['h', 'H', 'р', 'Р'].includes(e.key)) setSettingsState((s) => ({ ...s, showPanel: !s.showPanel }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings.embed])

  const L = settings.lang
  const title = isCustom ? `${custom?.title ?? ''}${countryKey && cyear !== null ? ` · ${cyear}` : ''}`
    : countryKey ? `${cvals?.title ?? countryDs?.title[L] ?? regionDs?.title[L] ?? ''}${cyear !== null ? ` · ${cyear}` : ''}`
    : dataset ? `${(() => {
        const gt = dataset.group_title?.[L] ?? dataset.title[L]
        const forecast = series && /прогноз|projection/.test(series.B.title[L]) && series.year > 2030 ? ` (${L === 'ru' ? 'прогноз' : 'projection'})` : ''
        const main = series ? `${gt} ${Math.round(series.year)}${forecast}` : dataset.title[L]
        if (!compareDs) return main
        const sameSeries = compareDs.group === dataset.group && compareDs.year !== undefined
        return sameSeries ? `${gt}: ${series ? Math.round(series.year) : dataset.year} − ${compareDs.year}` : `${main} − ${compareDs.title[L]}`
      })()}${region && isRegion ? ` · ${region.title[L]}` : ''}` : ''
  const totalVal = grid?.meta.total_population
  const total = (() => {
    if (!grid || totalVal === null || totalVal === undefined) return ''
    if (isCustom) return `${t(L, 'sum')}: ${formatCount(totalVal, L)} ${unit}`.trim()
    if (diffMode) return `${t(L, 'change')}: ${totalVal > 0 ? '+' : ''}${formatCount(totalVal, L)}${dataset?.group === 'pop' ? '' : ` ${unit}`}`
    if (!dataset?.total_label) return ''
    if (dataset.group === 'pop') return `${isRegion ? t(L, 'totalIn') : t(L, 'total')}: ${formatCount(totalVal, L)}`
    // денежные суммы — со знаком валюты перед числом: «ВВП мира (ППС): $196,56 трлн»
    return `${dataset.total_label[L]}: ${unit.includes('$') ? '$' : ''}${formatCount(totalVal, L)}`
  })()
  const source = isCustom ? (custom?.source ?? t(L, 'customData')) : countryKey ? (countryDs?.source ?? regionDs?.source) : dataset?.source
  const loading = !error && !(grid || cvals)

  return (
    <div className="relative h-full w-full">
      <DeckGL
        ref={deckRef}
        // запись видео без видеокарты: MSAA в программном рендере — основная цена кадра
        deviceProps={settings.render ? { webgl: { antialias: false } } as never : undefined}
        views={view}
        viewState={viewState as never}
        onViewStateChange={({ viewState: v, interactionState: is }) => {
          if (playing && (is?.isDragging || is?.isZooming || is?.isRotating || is?.isPanning)) setPlaying(false)
          setViewState(v as ViewState)
        }}
        layers={layers}
        onAfterRender={() => labelsRef.current?.update(deckRef.current?.deck?.getViewports()[0], isGlobe)}
        style={{ background: isGlobe ? theme.bg : theme.mapBg }}
      />

      <Labels ref={labelsRef} items={labelItems} instant={settings.render} />

      <div className={`pointer-events-none absolute select-none ${settings.embed ? 'left-3 top-2' : 'left-5 top-4'}`} data-testid="hud">
        <div className={`${settings.embed ? 'text-lg' : 'text-2xl'} font-extrabold tracking-tight drop-shadow ${theme.text}`} data-testid="title">{title}</div>
        {total && <div className={`text-sm ${theme.sub}`} data-testid="total">{total}</div>}
        {unit && !total && <div className={`text-sm ${theme.sub}`} data-testid="unit">{unit}</div>}
      </div>

      {settings.showLegend && (cvals || shape) && (
        cvals
          ? <Legend palette={settings.palette} scale={settings.scale} max={cvals.max} min={Math.min(0, cvals.min)}
              unit={unit} lang={L} theme={settings.theme} noData={theme.land} />
          : diffMode
            ? <Legend palette="diverge" scale={settings.scale} max={maxAbs} min={-maxAbs} diverging
                unit={`Δ ${unit}`} lang={L} theme={settings.theme} />
          : <Legend palette={settings.palette} scale={settings.scale} max={normMax} min={vmin}
              unit={unit} lang={L} theme={settings.theme} />
      )}

      {caption && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-6" data-testid="caption"
          style={{ opacity: captionOpacity, transform: `translateY(${(1 - captionOpacity) * 12}px)` }}>
          <div className={`max-w-[80%] text-center text-3xl font-extrabold tracking-tight ${settings.theme === 'light'
            ? 'text-slate-800 [text-shadow:0_1px_12px_rgba(255,255,255,0.9)]' : 'text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.9)]'}`}>
            {caption.text[settings.lang] ?? caption.text.ru ?? caption.text.en}
          </div>
        </div>
      )}

      {loading && (
        <div className={`absolute inset-0 grid place-items-center ${theme.sub}`}>{t(L, 'loading')}</div>
      )}
      {error && (
        <div className="absolute inset-x-0 top-20 mx-auto w-fit rounded bg-red-900/80 px-4 py-2 text-white" data-testid="error">{error}</div>
      )}

      {!settings.showPanel && !settings.embed && !settings.render && catalog && (
        <button type="button" data-testid="show-panel" onClick={() => set({ showPanel: true })} data-theme={settings.theme}
          className="gv-ui gv-panel gv-focus absolute right-3 top-3 z-30 flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium">
          <SlidersHorizontal size={15} /> {t(L, 'settings')}
        </button>
      )}
      {settings.showPanel && !settings.embed && catalog && (
        <Panel settings={settings} set={set} catalog={catalog} groups={groups} levels={levels} activeRes={level?.res}
          years={cvalsAll?.years ?? null} activeYear={cyear}
          compare={!countryKey && !isCustom && baseDataset ? {
            options: (catalog?.datasets ?? []).filter((d) => d.unit.ru === baseDataset.unit.ru && d.id !== baseDataset.id)
              .map((d) => ({ id: d.id, label: d.group === baseDataset.group && d.year !== undefined ? String(d.year) : d.title[L] })),
            active: settings.compareWith,
          } : null}
          seriesRange={!countryKey && !isCustom && baseDataset?.year !== undefined ? (() => {
            const ys = (catalog?.datasets ?? []).filter((d) => d.group === baseDataset.group && d.unit.ru === baseDataset.unit.ru && d.year !== undefined).map((d) => d.year!)
            return ys.length >= 3 ? { min: Math.min(...ys), max: Math.max(...ys), value: series ? series.year : baseDataset.year!, smooth: Boolean(series) } : null
          })() : null}
          numbersValue={countryKey ? null : [isCustom ? t(L, 'value') : (dataset?.value_label?.[L] ?? t(L, 'value')), unit].filter(Boolean).join(', ')}
          custom={custom ? { title: custom.title } : null}
          onProjection={switchProjection} onFocus={chooseFocus} onDataset={chooseDataset}
          onCountryDataset={chooseCountryDataset} onRegionDataset={chooseRegionDataset} onUpload={openCsv} onCloseCustom={() => { set({ custom: null }); history.replaceState(null, '', location.pathname) }}
          player={{
            scenarios: customScenario ? [...SCENARIOS, customScenario] : SCENARIOS, active: scenario, time,
            duration: scenario ? scenarioDuration(scenario) : 0, playing,
            onPick: pickScenario, onPlay: () => { if (scenario && time >= scenarioDuration(scenario)) applyAt(scenario, 0); setPlaying(true) },
            onPause: () => setPlaying(false), onStop: () => { setPlaying(false); if (scenario) applyAt(scenario, 0) },
            onSeek: (tt) => { setPlaying(false); if (scenario) applyAt(scenario, tt) },
            onAddKeyframe: addKeyframe, onExport: exportScenario, onImport: importScenario,
            onVideo: () => setVideoOpen(true), onHelp: () => setHelpOpen(true),
          }} />
      )}

      {/* указание источника (условие CC BY) — на подложке, чтобы читалось поверх любых данных */}
      <div data-testid="attribution" className={`pointer-events-none absolute bottom-1.5 left-4 max-w-[calc(100%-2rem)] truncate rounded-md px-1.5 py-0.5 text-[11px] ${theme.sub} ${
        settings.theme === 'light' ? 'bg-white/75' : 'bg-black/55'}`}>
        {t(L, 'source')}: {source}; Natural Earth
      </div>
      {videoOpen && scenario && <VideoModal lang={L} theme={settings.theme} scenario={scenario} onClose={() => setVideoOpen(false)} />}
      {csvOpen && <CsvModal lang={L} theme={settings.theme} countries={countries.map((c) => ({ code: c.iso3, ru: c.ru, en: c.en }))} regions={admin1Refs}
        onShow={showLocal} onClose={() => setCsvOpen(false)}
        onSaved={(id) => { setCsvOpen(false); history.replaceState(null, '', `?ds=${id}`); set({ custom: id }) }} />}
      {helpOpen && <ScenarioHelp lang={L} theme={settings.theme} onClose={() => setHelpOpen(false)} onUseTemplate={importScenario} />}

      {settings.embed && (
        <a href={location.href.replace(/([?&])embed=1&?/, '$1')} target="_blank" rel="noreferrer"
          className={`absolute bottom-2 right-3 text-[11px] font-semibold ${theme.sub} opacity-80 hover:opacity-100`}>GeoVis ↗</a>
      )}
    </div>
  )
}

type CV = { iso3?: string; code?: string; value: number }   // страны — iso3, регионы — code (ISO 3166-2)
function toCountryValues(j: { values: CV[]; years?: number[]; series?: Record<string, CV[]>; max_value?: number; min_value?: number },
  title: string, unit: string): CountryValues {
  const key = (v: CV) => (v.iso3 ?? v.code)!
  const m = new Map(j.values.map((v) => [key(v), v.value]))
  const nums = j.values.map((v) => v.value)
  const out: CountryValues = { title, unit, values: m, max: j.max_value ?? Math.max(...nums), min: j.min_value ?? Math.min(...nums) }
  if (j.years && j.series) {
    out.years = j.years
    out.series = new Map(j.years.map((y) => [y, new Map((j.series![String(y)] ?? []).map((v) => [key(v), v.value]))]))
  }
  return out
}
