export type Projection = 'globe' | 'map'
export type ScaleMode = 'log' | 'sqrt' | 'linear'
export type Lang = 'ru' | 'en'
export type NumbersMode = 'none' | 'population' | 'density'
export type PaletteId = 'relief' | 'inferno' | 'viridis' | 'neon' | 'ice' | 'diverge'
export type Mode = 'columns' | 'surface'
export type Theme = 'dark' | 'light'

export interface Settings {
  dataset: string          // id набора из catalog.json
  countryDataset: string | null  // набор «по странам» (картограмма) вместо сетки
  year: number | null      // год временного ряда «по странам» (null — последний)
  regionDataset: string | null  // набор по регионам стран (admin-1, ISO 3166-2)
  compareWith: string | null    // разница: текущий набор минус этот (те же единицы)
  seriesYear: number | null     // плавный год серии (1975…2100): смесь соседних эпох; в сценарии интерполируется
  custom: string | null    // id пользовательского набора из API (?ds=)
  embed: boolean           // режим встраивания (iframe): без панели
  render: boolean          // покадровая запись видео: без CSS-анимаций (кадр зависит только от t)
  focus: string            // 'world' или ISO3 региона (RUS)
  res: number              // шаг сетки, градусы
  mode: Mode
  theme: Theme
  projection: Projection
  scale: ScaleMode
  height: number           // множитель высоты
  smooth: number           // сглаживание формы, σ в ячейках сетки (0 — нет)
  palette: PaletteId
  lang: Lang
  showCities: boolean
  cityMinPop: number       // порог населения для подписи
  cityLimit: number        // не больше N подписей
  showCountries: boolean
  showLegend: boolean      // легенда цвета (видна и в роликах)
  numbers: NumbersMode
  showPanel: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  dataset: 'pop2025',
  countryDataset: null,
  year: null,
  regionDataset: null,
  compareWith: null,
  seriesYear: null,
  custom: null,
  embed: false,
  render: false,
  focus: 'world',
  res: 0.25,
  mode: 'columns',
  theme: 'dark',
  projection: 'globe',
  scale: 'log',
  height: 1,
  smooth: 0,
  palette: 'inferno',
  lang: 'ru',
  showCities: true,
  cityMinPop: 10_000_000,
  cityLimit: 40,
  showCountries: false,
  showLegend: true,
  numbers: 'density',
  showPanel: true,
}

/** Что меняется при выборе фокуса: мир — тёмный глобус со столбиками, страна — светлый макет-поверхность. */
export function focusPreset(focus: string): Partial<Settings> {
  if (focus === 'world') {
    return { focus, res: 0.25, mode: 'columns', theme: 'dark', palette: 'inferno', scale: 'log',
      projection: 'globe', cityMinPop: 10_000_000, cityLimit: 40, smooth: 0 }
  }
  return { focus, res: 0.1, mode: 'surface', theme: 'light', palette: 'relief', scale: 'sqrt',
    projection: 'map', cityMinPop: 500_000, cityLimit: 25, smooth: 2 }
}
