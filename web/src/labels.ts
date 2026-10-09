import { t } from './i18n'
import type { Lang, NumbersMode } from './settings'

export interface City {
  en: string; ru: string; lon: number; lat: number; pop: number
  iso3: string | null; country_en: string | null; country_ru: string | null; capital: boolean; rank: number
}

export interface Country {
  iso3: string; en: string; ru: string; lon: number; lat: number
  pop: number; area_km2: number; density: number; min_label: number
}

/** Города с населением ≥ minPop (в фокусе — только этой страны), крупнейшие первыми, не больше limit. */
export function selectCities(cities: City[], minPop: number, limit: number, focus = 'world'): City[] {
  return cities
    .filter((c) => c.pop >= minPop && (focus === 'world' || c.iso3 === focus))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, limit)
}

/** Число в «человеческом» виде: 23 400, 12,3 млн / 12.3 M. */
export function formatCount(n: number, lang: Lang, compact = false): string {
  const big = compact ? 1 : 2
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'
  const fmt = (v: number, digits: number) =>
    v.toLocaleString(locale, { maximumFractionDigits: digits }).replace(/ | /g, ' ')
  if (Math.abs(n) >= 1e12) return `${fmt(n / 1e12, big)} ${t(lang, 'trln')}`
  if (Math.abs(n) >= 1e9) return `${fmt(n / 1e9, big)} ${t(lang, 'bln')}`
  if (Math.abs(n) >= 1e6) return `${fmt(n / 1e6, 1)} ${t(lang, 'mln')}`
  if (Math.abs(n) >= 100) return fmt(Math.round(n), 0)
  return fmt(n, 1)
}

export interface LabelText { title: string; sub?: string }

function numberLine(pop: number, density: number, lang: Lang, numbers: NumbersMode, unit?: string): string | undefined {
  if (numbers === 'population') return formatCount(pop, lang)
  if (numbers === 'density') return `${formatCount(density, lang)} ${unit ?? t(lang, 'perKm2')}`
  return undefined
}

/** Подпись города; value — значение набора в его ячейке (то, что видно столбиком), unit — единицы набора. */
export function cityText(c: City, lang: Lang, numbers: NumbersMode, value: number, unit?: string, popIsNow = false): LabelText {
  // popIsNow: набор другого года (1975…, прогнозы) — население города есть только современное, так и подписываем
  const sub = numberLine(c.pop, value, lang, numbers, unit)
  return { title: lang === 'ru' ? c.ru : c.en, sub: sub && numbers === 'population' && popIsNow ? `${sub} · ${lang === 'ru' ? 'сейчас' : 'now'}` : sub }
}

/** Подпись страны со значением набора «по странам». */
export function countryValueText(c: Country, value: number, lang: Lang, unit: string): LabelText {
  return { title: lang === 'ru' ? c.ru : c.en, sub: `${formatCount(value, lang)} ${unit}` }
}

/** Подпись страны на сеточной карте. value — среднее значение ТЕКУЩЕГО набора по стране (в его единицах);
 *  null — значения нет (набор без расчёта по странам, страна мельче ячейки): тогда без числа, а не чужое число. */
export function countryText(c: Country, lang: Lang, numbers: NumbersMode, value: number | null, unit: string, signed = false,
  pop: number | null = null): LabelText {   // pop — население страны в год набора (наборы населения); иначе — оценка Natural Earth
  const title = lang === 'ru' ? c.ru : c.en
  if (numbers === 'population') {
    const p = pop ?? (signed ? null : c.pop)
    return p === null ? { title } : { title, sub: `${signed && p > 0 ? '+' : ''}${formatCount(p, lang)}` }
  }
  if (numbers === 'density' && value !== null && Number.isFinite(value)) {
    return { title, sub: `${signed && value > 0 ? '+' : ''}${formatCount(value, lang)} ${unit}`.trim() }
  }
  return { title }
}
