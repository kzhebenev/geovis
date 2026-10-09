import type { Lang, PaletteId, ScaleMode, Theme } from './settings'
import { colorAt, denormalize, divergeValue, PALETTES } from './scale'
import { formatCount } from './labels'
import { t } from './i18n'

interface Props {
  palette: PaletteId
  scale: ScaleMode
  max: number
  min: number            // < 0 — шкала начинается с минимума (температура)
  unit: string
  lang: Lang
  theme: Theme
  noData?: readonly number[] | null   // цвет «нет данных» (страны без значения)
  diverging?: boolean                 // разница: симметричная шкала −max…0…+max (нелинейная, как цвет)
}

const TICKS = [0, 0.25, 0.5, 0.75, 1]

/** Легенда цвета: та же шкала, что красит столбики/страны, подписи — обратным пересчётом. */
export default function Legend({ palette, scale, max, min, unit, lang, theme, noData, diverging }: Props) {
  if (!(max > min)) return null
  const pal = PALETTES[palette]
  const money = unit.includes('$')
  const fmt = (v: number) => `${diverging && v > 0 ? '+' : ''}${money && v >= 0 ? '$' : ''}${formatCount(v, lang, true)}`
  const gradient = `linear-gradient(90deg, ${Array.from({ length: 11 }, (_, i) =>
    `rgb(${colorAt(i / 10, pal).map(Math.round).join(',')})`).join(',')})`
  const light = theme === 'light'
  return (
    <div data-testid="legend"
      className={`pointer-events-none absolute bottom-7 left-5 w-[360px] max-w-[calc(100vw-2.5rem)] rounded-xl px-3 py-2 shadow-lg ring-1 ${
        light ? 'bg-white/80 text-slate-700 ring-slate-300' : 'bg-slate-950/70 text-slate-200 ring-white/10'}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold" data-testid="legend-unit">{unit}</span>
        <span className="opacity-70">{t(lang, scale)} · {t(lang, 'colorHeight')}</span>
      </div>
      <div className="relative h-2.5 rounded-sm" style={{ background: gradient }}>
        {TICKS.map((x) => (
          <span key={x} className={`absolute top-full h-1 w-px ${light ? 'bg-slate-500' : 'bg-slate-300'}`} style={{ left: `calc(${x * 100}% - ${x}px)` }} />
        ))}
      </div>
      {/* подписи точно под засечками (0/25/50/75/100%); крайние прижаты к краям */}
      <div className="relative mt-1.5 h-4 text-[10px] tabular-nums">
        {TICKS.map((x) => (
          <span key={x} data-testid="legend-tick" className="absolute whitespace-nowrap"
            style={{ left: `${x * 100}%`, transform: `translateX(${x === 0 ? 0 : x === 1 ? -100 : -50}%)` }}>
            {fmt(diverging ? divergeValue(x, max, scale) : denormalize(x, max, scale, min))}
          </span>
        ))}
      </div>
      {noData && (
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px] opacity-80">
          <span className={`inline-block h-2.5 w-4 rounded-sm ring-1 ${light ? 'ring-slate-400' : 'ring-white/40'}`} style={{ background: `rgb(${noData.join(',')})` }} />
          {t(lang, 'noData')}
        </div>
      )}
    </div>
  )
}
