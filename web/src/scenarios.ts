/** Готовые сценарии полёта (их можно экспортировать в JSON, поправить и загрузить обратно). */
import type { Scenario } from './scenario'

const WORLD = { focus: 'world', countryDataset: null, custom: null } as const
const RUS = { focus: 'RUS', res: 0.1, mode: 'surface', theme: 'light', palette: 'relief', scale: 'sqrt',
  projection: 'map', cityMinPop: 500_000, cityLimit: 25, smooth: 2, countryDataset: null, custom: null } as const

export const SCENARIOS: Scenario[] = [
  {
    id: 'earth-tour',
    title: { ru: 'Облёт Земли', en: 'Around the Earth' },
    keyframes: [
      { t: 0, camera: { longitude: -30, latitude: 20, zoom: 1.0, pitch: 0, bearing: 0 },
        settings: { ...WORLD, dataset: 'pop2025', mode: 'columns', theme: 'dark', projection: 'globe', palette: 'inferno',
          scale: 'log', res: 0.25, cityMinPop: 10_000_000, cityLimit: 12, numbers: 'density' },
        caption: { ru: 'Где живут 8,2 миллиарда человек', en: 'Where 8.2 billion people live' } },
      { t: 6, camera: { longitude: 10, latitude: 45, zoom: 2.2, pitch: 35, bearing: 10 }, caption: null },
      { t: 12, camera: { longitude: 30, latitude: 20, zoom: 2.4, pitch: 45, bearing: -10 },
        caption: { ru: 'Долина Нила', en: 'The Nile valley' } },
      { t: 19, camera: { longitude: 80, latitude: 22, zoom: 2.6, pitch: 50, bearing: -15 },
        caption: { ru: 'Индия и Бангладеш — самые плотные места планеты', en: 'India and Bangladesh — the densest places on Earth' } },
      { t: 27, camera: { longitude: 118, latitude: 30, zoom: 2.6, pitch: 50, bearing: 10 }, caption: null },
      { t: 33, camera: { longitude: 138, latitude: 36, zoom: 3.0, pitch: 55, bearing: 25 },
        caption: { ru: 'Токио — крупнейшая агломерация', en: 'Tokyo — the largest metro area' } },
      { t: 41, camera: { longitude: 150, latitude: 15, zoom: 1.2, pitch: 0, bearing: 0 }, easing: 'inOutSine', caption: null },
    ],
  },
  {
    id: 'russia-moscow',
    title: { ru: 'Россия: из космоса к Москве', en: 'Russia: from space to Moscow' },
    keyframes: [
      { t: 0, camera: { longitude: 100, latitude: 58, zoom: 2.3, pitch: 20, bearing: 0 },
        settings: { ...RUS, dataset: 'pop2025' },
        caption: { ru: 'Россия: 144 миллиона человек на 17 миллионах км²', en: 'Russia: 144 million people on 17 million km²' } },
      { t: 7, camera: { longitude: 75, latitude: 52, zoom: 2.9, pitch: 55, bearing: 25 }, caption: null },
      { t: 14, camera: { longitude: 52, latitude: 50, zoom: 3.6, pitch: 62, bearing: 35 },
        caption: { ru: 'Почти все живут западнее Урала', en: 'Almost everyone lives west of the Urals' } },
      // облёт вокруг Москвы: в deck.gl longitude/latitude — точка, на которую смотрит камера
      { t: 21, camera: { longitude: 37.62, latitude: 55.75, zoom: 3.6, pitch: 50, bearing: 25 }, caption: null },
      { t: 26, camera: { longitude: 37.62, latitude: 55.75, zoom: 3.8, pitch: 52, bearing: 90 },
        caption: { ru: 'Москва', en: 'Moscow' } },
      { t: 31, camera: { longitude: 37.62, latitude: 55.75, zoom: 3.8, pitch: 52, bearing: 200 }, easing: 'linear' },
      { t: 38, camera: { longitude: 64, latitude: 50, zoom: 3.0, pitch: 62, bearing: 30 }, caption: null },
    ],
  },
  {
    id: 'megacities-growth',
    title: { ru: 'Рост мегаполисов 1975→2100', en: 'Megacity growth 1975→2100' },
    // плавный год: эпохи смешиваются, столбики растут непрерывно (2030+ — прогноз WorldPop SSP2)
    keyframes: [
      { t: 0, camera: { longitude: 85, latitude: 18, zoom: 2.8, pitch: 50, bearing: -10 },
        settings: { ...WORLD, dataset: 'pop1975', compareWith: null, seriesYear: 1975, mode: 'columns', theme: 'dark', projection: 'map',
          palette: 'inferno', scale: 'sqrt', res: 0.25, cityMinPop: 10_000_000, cityLimit: 10, numbers: 'density' },
        caption: { ru: 'Как росли мегаполисы', en: 'How megacities grew' } },
      { t: 4, camera: { longitude: 90, latitude: 20, zoom: 2.8, pitch: 50, bearing: -6 }, easing: 'linear', caption: null },
      { t: 22, camera: { longitude: 105, latitude: 24, zoom: 2.6, pitch: 45, bearing: 6 }, easing: 'linear',
        settings: { seriesYear: 2025 }, caption: { ru: 'Сегодня', en: 'Today' } },
      { t: 26, camera: { longitude: 108, latitude: 25, zoom: 2.6, pitch: 45, bearing: 8 }, easing: 'linear', caption: null },
      { t: 40, camera: { longitude: 110, latitude: 26, zoom: 2.4, pitch: 40, bearing: 10 }, easing: 'linear',
        settings: { seriesYear: 2100 }, caption: { ru: '2100 — прогноз', en: '2100 — projection' } },
    ],
  },
]
