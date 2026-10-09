import { useMemo, useState } from 'react'
import { BarChart3, Building2, CircleDollarSign, Database, Globe2, Lightbulb, Map as MapIcon, Mountain, Search, Thermometer, Users } from 'lucide-react'
import type { Lang, Settings } from './settings'
import type { Group, License } from './catalog'
import { t } from './i18n'
import { inputCls, Modal } from './ui'

export const GROUP_ICONS: Record<string, typeof Users> = {
  pop: Users, built: Building2, lights: Lightbulb, relief: Mountain, climate: Thermometer, gdp: CircleDollarSign,
}

interface Props {
  lang: Lang
  groups: Group[]
  settings: Settings
  onDataset: (id: string) => void
  onCountryDataset: (id: string) => void
  onRegionDataset: (id: string) => void
  onClose: () => void
}

/** Выбор набора данных: группы карточками, поиск по названию/единицам/источнику; Esc и клик по фону — закрыть. */
export default function DataModal({ lang, groups, settings: s, onDataset, onCountryDataset, onRegionDataset, onClose }: Props) {
  const [q, setQ] = useState('')
  const L = (k: Parameters<typeof t>[1]) => t(lang, k)

  const needle = q.trim().toLowerCase()
  const match = (...xs: (string | number | undefined)[]) => !needle || xs.some((x) => String(x ?? '').toLowerCase().includes(needle))
  const shown = useMemo(() => groups.map((g) => ({
    ...g,
    datasets: g.datasets.filter((d) => match(d.title.ru, d.title.en, d.unit[lang], d.source, d.year, g.title.ru, g.title.en)),
    countries: g.countries.filter((c) => match(c.title.ru, c.title.en, c.unit[lang], c.source, g.title.ru, g.title.en)),
    regions: g.regions.filter((r) => match(r.title.ru, r.title.en, r.unit[lang], r.source, g.title.ru, g.title.en, 'регион')),
  })).filter((g) => g.datasets.length + g.countries.length + g.regions.length > 0), [groups, needle, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (fn: () => void) => { fn(); onClose() }
  const noOther = !s.countryDataset && !s.regionDataset && !s.custom
  const card = (active: boolean) => `gv-focus group rounded-xl p-3 text-left transition ${active
    ? 'bg-[var(--p-accent-soft)] ring-1 ring-[var(--p-accent)]/60' : 'bg-[var(--p-ctl)] ring-1 ring-transparent hover:bg-[var(--p-ctl-hover)]'}`
  const Item = ({ icon: I, title, meta, active, onClick, testid, license }: {
    icon: typeof Users; title: string; meta: string; active: boolean; onClick: () => void; testid: string; license?: License
  }) => (
    <button type="button" data-testid={testid} onClick={onClick} className={card(active)} title={license ? `${license.name}\n${license.cite ?? ''}` : undefined}>
      <div className="flex items-center gap-2 text-[13.5px] font-semibold">
        <I size={14} className={active ? 'text-[var(--p-accent)]' : 'text-[var(--p-faint)]'} /> <span className="truncate">{title}</span>
        {license?.restricted && <span data-testid={`restricted-${testid}`}
          className="ml-auto shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-600 ring-1 ring-amber-500/30">
          {lang === 'ru' ? 'некоммерч.' : 'non-commercial'}</span>}
      </div>
      <div className="mt-0.5 truncate pl-[22px] text-[11.5px] text-[var(--p-muted)]">{meta}</div>
    </button>
  )

  return (
    <Modal theme={s.theme} icon={Database} title={L('chooseData')} onClose={onClose} testid="data-modal" label={L('data')}>
      <label className="sticky top-0 z-10 -mx-1 mb-4 block bg-[var(--p-pop)] px-1 pb-1 pt-1">
        <span className="relative block">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--p-faint)]" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('searchData')}
            data-testid="data-search" className={`${inputCls} pl-9`} />
        </span>
      </label>
      {shown.length === 0 && <div className="py-10 text-center text-[13px] text-[var(--p-muted)]" data-testid="data-empty">{L('nothingFound')}</div>}
      <div className="space-y-5">
        {shown.map((g) => {
          const Icon = GROUP_ICONS[g.id] ?? Database
          const years = new Set(g.datasets.map((d) => d.year))
          const byYear = g.datasets.length > 2 && years.size === g.datasets.length
          const n = g.datasets.length + g.regions.length + g.countries.length
          return (
            <section key={g.id} data-testid={`group-${g.id}`}>
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--p-ctl-hover)] text-[var(--p-muted)]"><Icon size={14} /></span>
                {g.title[lang]}
                <span className="text-[11.5px] font-normal text-[var(--p-faint)]">{n}</span>
              </div>
              {byYear ? (
                <div className={`rounded-xl p-3 ${g.datasets.some((d) => d.id === s.dataset) && noOther
                  ? 'bg-[var(--p-accent-soft)] ring-1 ring-[var(--p-accent)]/60' : 'bg-[var(--p-ctl)]'}`}>
                  <div className="mb-2.5 text-[11.5px] text-[var(--p-muted)]">
                    {g.datasets[0].unit[lang]} · {g.datasets[0].source.split(' (')[0].replace(/ E\d{4}/, '')}
                    {g.datasets.some((d) => d.year! > new Date().getFullYear()) && <span className="italic"> · {lang === 'ru' ? 'курсив — прогноз' : 'italic — projection'}</span>}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1.5">
                    {g.datasets.map((d) => {
                      const on = noOther && s.dataset === d.id
                      return (
                        <button key={d.id} type="button" data-testid={`dataset-${d.id}`} onClick={() => pick(() => onDataset(d.id))}
                          title={d.title[lang]}
                          className={`gv-focus h-8 rounded-lg text-[12.5px] font-medium tabular-nums transition ${on
                            ? 'bg-[var(--p-accent)] text-[var(--p-accent-fg)] shadow-sm'
                            : `bg-[var(--p-thumb)] text-[var(--p-text)] shadow-[var(--p-thumb-shadow)] hover:ring-1 hover:ring-[var(--p-accent)]/60 ${d.year! > new Date().getFullYear() ? 'italic' : ''}`}`}>
                          {d.year}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : g.datasets.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {g.datasets.map((d) => (
                    <Item key={d.id} testid={`dataset-${d.id}`} icon={BarChart3} title={d.title[lang]} active={noOther && s.dataset === d.id}
                      meta={`${d.unit[lang]} · ${d.source.split(' (')[0]}`} license={d.license} onClick={() => pick(() => onDataset(d.id))} />
                  ))}
                </div>
              )}
              {g.regions.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {g.regions.map((r) => (
                    <Item key={r.id} testid={`regions-${r.id}`} icon={MapIcon} title={r.title[lang]}
                      active={s.regionDataset === r.id && !s.countryDataset && !s.custom} onClick={() => pick(() => onRegionDataset(r.id))}
                      meta={`${L('byRegion')} · ${r.unit[lang]}${r.years ? ` · ${r.years[0]}${r.years[1] !== r.years[0] ? `–${r.years[1]}` : ''}` : ''}`} />
                  ))}
                </div>
              )}
              {g.countries.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {g.countries.map((c) => (
                    <Item key={c.id} testid={`countries-${c.id}`} icon={Globe2} title={c.title[lang]}
                      active={s.countryDataset === c.id && !s.custom} onClick={() => pick(() => onCountryDataset(c.id))}
                      meta={`${L('byCountry')} · ${c.unit[lang]}${c.years ? ` · ${c.years[0]}–${c.years[1]}` : ''}`} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </Modal>
  )
}
