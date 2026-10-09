import { useState, type ComponentProps } from 'react'
import { BarChart3, ChevronRight, Clapperboard, Database, Globe2, Map as MapIcon, Moon, Mountain, Palette, PanelRightClose, SlidersHorizontal, Sun, Tags, Upload, X } from 'lucide-react'
import type { Settings } from './settings'
import type { Catalog, Group, Level } from './catalog'
import Player from './Player'
import DataModal, { GROUP_ICONS } from './DataModal'
import { colorAt, PALETTES } from './scale'
import { t } from './i18n'
import { Field, Group as UiGroup, IconButton, Segmented, Select, Slider, Toggle } from './ui'

interface Props {
  settings: Settings
  set: (p: Partial<Settings>) => void
  onProjection: (p: Settings['projection']) => void
  onFocus: (focus: string) => void
  onDataset: (id: string) => void
  onCountryDataset: (id: string) => void
  onRegionDataset: (id: string) => void
  onUpload: () => void
  onCloseCustom: () => void
  custom: { title: string } | null
  years: number[] | null
  activeYear: number | null
  numbersValue: string | null
  compare: { options: { id: string; label: string }[]; active: string | null } | null
  seriesRange: { min: number; max: number; value: number; smooth: boolean } | null   // подпись кнопки значения: «Осадки, мм/год»; null — раздел «Цифры» не нужен (страны/регионы)
  player: Omit<ComponentProps<typeof Player>, 'lang' | 'theme'>
  groups: Group[]
  catalog: Catalog
  levels: Level[]
  activeRes?: number
}

const CITY_MIN = [20e6, 10e6, 5e6, 1e6, 3e5]
const CITY_LIMIT = [10, 25, 50, 100]
const HEIGHTS = [0.5, 1, 1.5, 2.5]
const gradient = (p: keyof typeof PALETTES) => `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1]
  .map((x) => `rgb(${colorAt(x, PALETTES[p]).map(Math.round).join(',')})`).join(',')})`

export default function Panel({ settings: s, set, onProjection, onFocus, onDataset, onCountryDataset, onRegionDataset, onUpload, onCloseCustom,
  custom, groups, catalog, levels, activeRes, player, years, activeYear, numbersValue, compare, seriesRange }: Props) {
  const L = (k: Parameters<typeof t>[1]) => t(s.lang, k)
  const [dataOpen, setDataOpen] = useState(false)
  const activeGroup = groups.find((x) => (!s.countryDataset && !s.regionDataset && x.datasets.some((d) => d.id === s.dataset))
    || x.countries.some((c) => c.id === s.countryDataset) || (!s.countryDataset && x.regions.some((r) => r.id === s.regionDataset)))
  const activeTitle = s.countryDataset
    ? activeGroup?.countries.find((c) => c.id === s.countryDataset)?.title[s.lang]
    : s.regionDataset ? activeGroup?.regions.find((r) => r.id === s.regionDataset)?.title[s.lang]
    : catalog.datasets.find((d) => d.id === s.dataset)?.title[s.lang]
  const ActiveIcon = (activeGroup && GROUP_ICONS[activeGroup.id]) || Database
  const short = (n: number) => (n >= 1e6 ? `${n / 1e6} ${L('mln')}` : `${n / 1e3} ${L('thousand')}`)
  const theme = s.theme

  return (
    <aside data-testid="panel" data-theme={theme}
      className="gv-ui gv-panel absolute inset-x-2 bottom-2 z-30 flex max-h-[58%] flex-col overflow-hidden rounded-2xl sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:max-h-[calc(100%-1.5rem)] sm:w-[320px]">
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <SlidersHorizontal size={15} className="text-[var(--p-muted)]" />
        <span className="flex-1 text-[13px] font-semibold">{L('settings')}</span>
        <div className="w-[76px]">
          <Segmented size="sm" value={s.lang} onChange={(v) => set({ lang: v })}
            options={[{ value: 'ru', label: 'RU', testid: 'lang-ru' }, { value: 'en', label: 'EN', testid: 'lang-en' }]} />
        </div>
        <IconButton icon={PanelRightClose} title={L('hidePanel')} testid="hide-panel" onClick={() => set({ showPanel: false })} />
      </header>

      <div className="gv-scroll min-h-0 flex-1 overflow-y-auto">
        {/* данные — главное, всегда на виду */}
        <div className="space-y-3.5 px-4 pb-4 pt-1">
          {custom && (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-500/12 p-2.5 ring-1 ring-emerald-500/40" data-testid="custom-card">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/20 text-emerald-500"><Database size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{L('yourData')}</span>
                <span className="block truncate text-[13.5px] font-semibold">{custom.title}</span>
              </span>
              <IconButton icon={X} title={L('close')} onClick={onCloseCustom} />
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" data-testid="open-data" onClick={() => setDataOpen(true)} disabled={Boolean(s.custom)}
              className="gv-focus group flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-[var(--p-accent-soft)] p-2.5 text-left ring-1 ring-[var(--p-accent)]/35 transition hover:ring-[var(--p-accent)]/70 disabled:opacity-50">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--p-accent)] text-[var(--p-accent-fg)]"><ActiveIcon size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-[var(--p-accent)]">{L('data')}</span>
                <span className="block truncate text-[13.5px] font-semibold" data-testid="active-dataset">{activeTitle}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-[var(--p-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--p-muted)]" />
            </button>
            <button type="button" data-testid="open-upload" onClick={onUpload} title={L('yourDataUpload')} aria-label={L('yourDataUpload')}
              className="gv-focus grid w-11 shrink-0 place-items-center rounded-xl bg-[var(--p-ctl)] text-[var(--p-muted)] transition hover:bg-[var(--p-ctl-hover)] hover:text-[var(--p-text)]">
              <Upload size={17} />
            </button>
          </div>
          {dataOpen && <DataModal lang={s.lang} groups={groups} settings={s} onDataset={onDataset}
            onCountryDataset={onCountryDataset} onRegionDataset={onRegionDataset} onClose={() => setDataOpen(false)} />}

          {years && years.length > 1 && activeYear !== null && (
            <Field label={L('year')} value={activeYear}>
              <div data-testid="year-slider">
                <Slider min={0} max={years.length - 1} step={1} value={Math.max(0, years.indexOf(activeYear))} testid="year-range"
                  edges={false} onChange={(i) => set({ year: years[i] })} />
                <div className="flex justify-between text-[11px] tabular-nums text-[var(--p-faint)]"><span>{years[0]}</span><span>{years[years.length - 1]}</span></div>
              </div>
            </Field>
          )}

          {seriesRange && (
            <Field label={L('smoothYear')} value={Math.round(seriesRange.value)}>
              <div data-testid="series-slider">
                <Slider min={seriesRange.min} max={seriesRange.max} step={1} value={Math.round(seriesRange.value)} testid="series-range"
                  onChange={(v) => set({ seriesYear: v })} />
              </div>
            </Field>
          )}

          {compare && compare.options.length > 0 && (
            <Field label={L('compare')}>
              <Select theme={theme} testid="compare-select" value={compare.active ?? ''} onChange={(v) => set({ compareWith: v || null })}
                options={[{ value: '', label: L('off'), testid: 'compare-off' },
                  ...compare.options.map((o) => ({ value: o.id, label: o.label, testid: `compare-${o.id}` }))]} />
            </Field>
          )}
        </div>

        <UiGroup id="scenario" title={L('scenario')} icon={Clapperboard}>
          <Player lang={s.lang} theme={theme} {...player} />
        </UiGroup>

        <UiGroup id="scene" title={L('scene')} icon={Globe2}>
          <Field label={L('focus')}>
            <Select theme={theme} testid="focus-select" value={s.focus} onChange={onFocus}
              options={[{ value: 'world', label: L('world'), testid: 'focus-world' },
                ...catalog.regions.map((r) => ({ value: r.iso3, label: r.title[s.lang], hint: r.iso3, testid: `focus-${r.iso3}` }))]} />
          </Field>
          <Field label={L('mode')}>
            <Segmented value={s.mode} onChange={(v) => set({ mode: v })} options={[
              { value: 'columns', label: L('columns'), icon: BarChart3, testid: 'mode-columns' },
              { value: 'surface', label: L('surface'), icon: Mountain, testid: 'mode-surface' }]} />
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label={L('projection')}>
              <Segmented value={s.projection} onChange={onProjection} options={[
                { value: 'globe', label: L('globe'), icon: Globe2, testid: 'proj-globe' },
                { value: 'map', label: L('map'), icon: MapIcon, testid: 'proj-map' }]} />
            </Field>
            <Field label={L('theme')}>
              <Segmented value={s.theme} onChange={(v) => set({ theme: v })} options={[
                { value: 'dark', icon: Moon, title: L('dark'), testid: 'theme-dark' },
                { value: 'light', icon: Sun, title: L('light'), testid: 'theme-light' }]} />
            </Field>
          </div>
        </UiGroup>

        <UiGroup id="display" title={L('display')} icon={Palette}>
          {levels.length > 1 && (
            <Field label={L('detail')}>
              <Segmented value={activeRes ?? levels[0].res} onChange={(v) => set({ res: v })}
                options={levels.map((l) => ({ value: l.res, label: `${l.res}°`, testid: `level-${l.res}` }))} />
            </Field>
          )}
          <Field label={L('scale')}>
            <Segmented value={s.scale} onChange={(v) => set({ scale: v })}
              options={(['log', 'sqrt', 'linear'] as const).map((m) => ({ value: m, label: L(m), testid: `scale-${m}` }))} />
          </Field>
          <Field label={L('height')}>
            <Segmented value={s.height} onChange={(v) => set({ height: v })}
              options={HEIGHTS.map((h) => ({ value: h, label: `×${h}` }))} />
          </Field>
          <Field label={L('smooth')}>
            <Segmented value={s.smooth} onChange={(v) => set({ smooth: v })}
              options={([[0, 'none'], [1, 'soft'], [2, 'soft'], [4, 'strong']] as const).map(([v, k], i) => ({
                value: v, testid: `smooth-${v}`, label: i === 0 ? L('none') : `${L(k)}${i === 2 ? '+' : ''}` }))} />
          </Field>
          <Field label={L('palette')}>
            <Select theme={theme} testid="palette-select" value={s.palette} onChange={(v) => set({ palette: v })}
              options={(Object.keys(PALETTES) as (keyof typeof PALETTES)[])
                .filter((p) => p !== 'diverge' || s.palette === 'diverge')   // расходящаяся — для разницы наборов, ставится сама
                .map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1), swatch: gradient(p), testid: `palette-${p}` }))} />
          </Field>
        </UiGroup>

        <UiGroup id="labels" title={L('labels')} icon={Tags}>
          <div className="-my-0.5">
            <Toggle label={L('cities')} checked={s.showCities} onChange={(v) => set({ showCities: v })} testid="toggle-cities" />
            <Toggle label={L('countries')} checked={s.showCountries} onChange={(v) => set({ showCountries: v })} testid="toggle-countries" />
            <Toggle label={L('legend')} checked={s.showLegend} onChange={(v) => set({ showLegend: v })} testid="toggle-legend" />
          </div>
          {s.showCities && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={L('cityMin')}>
                <Select theme={theme} testid="citymin-select" value={s.cityMinPop} onChange={(v) => set({ cityMinPop: v })}
                  options={CITY_MIN.map((n) => ({ value: n, label: short(n) }))} />
              </Field>
              <Field label={L('cityLimit')}>
                <Select theme={theme} testid="citylimit-select" value={s.cityLimit} onChange={(v) => set({ cityLimit: v })}
                  options={CITY_LIMIT.map((n) => ({ value: n, label: String(n) }))} />
              </Field>
            </div>
          )}
          {numbersValue && (
            <Field label={L('numbers')}>
              {/* ключ 'density' исторический — это «значение текущего набора» (сценарии и ссылки не ломаем) */}
              <Segmented stack value={s.numbers} onChange={(v) => set({ numbers: v })} options={[
                { value: 'none', label: L('none'), testid: 'numbers-none' },
                { value: 'density', label: numbersValue, title: numbersValue, testid: 'numbers-density' },
                { value: 'population', label: L('cityPopulation'), title: L('cityPopulation'), testid: 'numbers-population' }]} />
            </Field>
          )}
        </UiGroup>
      </div>
    </aside>
  )
}
