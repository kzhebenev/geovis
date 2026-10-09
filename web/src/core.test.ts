import { describe, expect, it } from 'vitest'
import { colorAt, normalize, PALETTES } from './scale'
import { facesCamera, placeLabels } from './placement'
import { cityText, formatCount, selectCities, type City } from './labels'
import { sampleDensity, toCells, type Grid } from './grid'

describe('normalize', () => {
  it('0 и отрицательные → 0, максимум → 1', () => {
    for (const m of ['log', 'sqrt', 'linear'] as const) {
      expect(normalize(0, 1000, m)).toBe(0)
      expect(normalize(-5, 1000, m)).toBe(0)
      expect(normalize(NaN, 1000, m)).toBe(0)
      expect(normalize(1000, 1000, m)).toBeCloseTo(1)
      expect(normalize(5000, 1000, m)).toBeCloseTo(1) // выше максимума — обрезается
    }
  })
  it('монотонна', () => {
    for (const m of ['log', 'sqrt', 'linear'] as const) {
      expect(normalize(10, 1e4, m)).toBeLessThan(normalize(100, 1e4, m))
    }
  })
  it('лог-шкала не поднимает сельскую местность (10 чел/км² < 10% высоты)', () => {
    expect(normalize(10, 54000, 'log')).toBeLessThan(0.1)
    expect(normalize(20000, 54000, 'log')).toBeGreaterThan(0.8)
  })
})

describe('colorAt', () => {
  it('концы палитры — опорные цвета', () => {
    expect(colorAt(0, PALETTES.inferno)).toEqual(PALETTES.inferno[0])
    expect(colorAt(1, PALETTES.inferno)).toEqual(PALETTES.inferno[4])
    expect(colorAt(2, PALETTES.inferno)).toEqual(PALETTES.inferno[4])
  })
})

describe('placeLabels', () => {
  const c = (key: string, x: number, y: number, priority: number, visible = true) =>
    ({ key, x, y, w: 100, h: 30, priority, visible })
  it('при наложении остаётся важнейшая подпись', () => {
    const r = placeLabels([c('small', 100, 100, 1), c('big', 110, 105, 9)], 800, 600)
    expect([...r]).toEqual(['big'])
  })
  it('непересекающиеся показываются все', () => {
    expect(placeLabels([c('a', 100, 100, 1), c('b', 400, 300, 2)], 800, 600).size).toBe(2)
  })
  it('невидимые и за кадром — не показываются', () => {
    expect(placeLabels([c('back', 100, 100, 9, false), c('off', -500, 100, 9)], 800, 600).size).toBe(0)
  })
})

describe('facesCamera', () => {
  it('ближняя сторона сферы видна, дальняя — нет', () => {
    const cam = [0, 0, 1000]
    expect(facesCamera([0, 0, 256], cam)).toBe(true)
    expect(facesCamera([0, 0, -256], cam)).toBe(false)
  })
})

describe('labels', () => {
  const tokyo: City = { en: 'Tokyo', ru: 'Токио', lon: 139.7, lat: 35.7, pop: 35676000,
    iso3: 'JPN', country_en: 'Japan', country_ru: 'Япония', capital: true, rank: 0 }
  it('formatCount RU/EN', () => {
    expect(formatCount(8.192e9, 'ru')).toBe('8,19 млрд')
    expect(formatCount(8.192e9, 'en')).toBe('8.19 B')
    expect(formatCount(35676000, 'ru')).toBe('35,7 млн')
    expect(formatCount(23456.4, 'ru')).toBe('23 456')
  })
  it('cityText по режимам', () => {
    expect(cityText(tokyo, 'ru', 'none', 0)).toEqual({ title: 'Токио', sub: undefined })
    expect(cityText(tokyo, 'en', 'population', 0)).toEqual({ title: 'Tokyo', sub: '35.7 M' })
    expect(cityText(tokyo, 'ru', 'density', 13394)).toEqual({ title: 'Токио', sub: '13 394 чел/км²' })
  })
  it('selectCities: порог и лимит', () => {
    const list = [tokyo, { ...tokyo, en: 'Small', pop: 100 }]
    expect(selectCities(list, 1e6, 10).map((c) => c.en)).toEqual(['Tokyo'])
    expect(selectCities(list, 0, 1).length).toBe(1)
  })
  it('selectCities в фокусе страны: только её города', () => {
    const moscow = { ...tokyo, en: 'Moscow', iso3: 'RUS', pop: 12e6 }
    expect(selectCities([tokyo, moscow], 0, 10, 'RUS').map((c) => c.en)).toEqual(['Moscow'])
    expect(selectCities([tokyo, moscow], 0, 10, 'world').length).toBe(2)
  })
})

describe('grid', () => {
  const g: Grid = {
    name: 't',
    meta: { file: '', res: 90, width: 4, height: 2, west: -180, north: 90, total_population: 0, max_density: 9, p99_density: 9 },
    data: new Float32Array([0, 5, 0, 0, 0, 0, 0, 9]),
  }
  it('toCells берёт только непустые ячейки с центрами', () => {
    const c = toCells(g)
    expect(c.n).toBe(2)
    expect([c.lon[0], c.lat[0], c.density[0]]).toEqual([-45, 45, 5])
    expect([c.lon[1], c.lat[1], c.density[1]]).toEqual([135, -45, 9])
  })
  it('sampleDensity', () => {
    expect(sampleDensity(g, -60, 10)).toBe(5)
    expect(sampleDensity(g, 170, -80)).toBe(9)
    expect(sampleDensity(g, -170, -80)).toBe(0)
  })
})

import { levelsFor, pickLevel, type Dataset } from './catalog'
import { focusPreset } from './settings'

describe('catalog', () => {
  const lv = (res: number, name: string) => ({ res, name, max_density: 1 })
  const ds: Dataset = {
    id: 'pop2025', group: 'pop', title: { ru: '', en: '' }, unit: { ru: '', en: '' }, source: '', year: 2025,
    levels: [lv(1, 'g_1p0'), lv(0.5, 'g_0p5'), lv(0.25, 'g_0p25'), lv(0.1, 'g_0p1')],
    regions: { RUS: [lv(0.1, 'RUS_0p1'), lv(0.05, 'RUS_0p05')] },
  }
  it('уровни по фокусу и виду: поверхность мира не мельче 0.25°', () => {
    expect(levelsFor(ds, 'world', 'columns').length).toBe(4)
    expect(levelsFor(ds, 'world', 'surface').map((l) => l.res)).toEqual([1, 0.5, 0.25])
    expect(levelsFor(ds, 'RUS', 'surface').map((l) => l.name)).toEqual(['RUS_0p1', 'RUS_0p05'])
    expect(levelsFor(ds, 'XXX', 'surface')).toEqual([]) // негатив: неизвестный регион
  })
  it('pickLevel: точный или ближайший', () => {
    expect(pickLevel(ds.levels, 0.25)?.name).toBe('g_0p25')
    expect(pickLevel(ds.regions.RUS, 0.25)?.name).toBe('RUS_0p1')
    expect(pickLevel([], 0.25)).toBeUndefined()
  })
  it('фокус на стране включает светлый макет-поверхность', () => {
    expect(focusPreset('RUS')).toMatchObject({ mode: 'surface', theme: 'light', palette: 'relief', projection: 'map' })
    expect(focusPreset('world')).toMatchObject({ mode: 'columns', theme: 'dark', projection: 'globe' })
  })
})

import { parseUrl } from './urlstate'
import { normalize as norm2 } from './scale'

describe('parseUrl', () => {
  it('регионы: focus из ссылки не применяется (страна — из набора), у сеток — применяется', () => {
    expect(parseUrl('?regions=rosstat_vrp&focus=RUS').settings).toMatchObject({ regionDataset: 'rosstat_vrp', focus: 'world' })
    expect(parseUrl('?dataset=pop2025&focus=RUS').settings.focus).toBe('RUS')
  })
  it('ссылка на пользовательский набор с видом и камерой', () => {
    const r = parseUrl('?ds=Ab12x&mode=surface&theme=light&cam=40,55,4,50,10&embed=1')
    expect(r.settings).toMatchObject({ custom: 'Ab12x', mode: 'surface', theme: 'light', embed: true, showPanel: false })
    expect(r.camera).toEqual({ longitude: 40, latitude: 55, zoom: 4, pitch: 50, bearing: 10 })
  })
  it('встроенный набор и фокус', () => {
    expect(parseUrl('?dataset=gdp2024&focus=RUS').settings).toMatchObject({ dataset: 'gdp2024', focus: 'RUS' })
  })
  it('негатив: мусор и инъекции игнорируются', () => {
    const r = parseUrl('?ds=../../etc&mode=evil&cam=1,2&smooth=99&dataset=<script>&focus=x%20y')
    expect(r.settings).toEqual({})
    expect(r.camera).toBeUndefined()
  })
})

describe('normalize c минимумом (температура)', () => {
  it('самое холодное — 0, самое тёплое — 1, 0 °C — посередине шкалы', () => {
    expect(norm2(-30, 30, 'linear', -30)).toBe(0)
    expect(norm2(30, 30, 'linear', -30)).toBeCloseTo(1)
    expect(norm2(0, 30, 'linear', -30)).toBeCloseTo(0.5)
  })
})

import { denormalize } from './scale'

describe('denormalize (подписи легенды)', () => {
  it('обратна normalize для всех шкал, в том числе с отрицательным минимумом', () => {
    for (const mode of ['log', 'sqrt', 'linear'] as const) {
      for (const [max, min] of [[54000, 0], [30.6, -54.7], [3.08e13, 0]]) {
        for (const t of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
          const v = denormalize(t, max, mode, min)
          expect(norm2(v, max, mode, min)).toBeCloseTo(t, 6)
        }
      }
    }
  })
  it('концы шкалы — минимум и максимум', () => {
    expect(denormalize(0, 100, 'sqrt')).toBe(0)
    expect(denormalize(1, 100, 'log')).toBeCloseTo(100)
    expect(denormalize(0, 30, 'linear', -50)).toBe(-50)
  })
})

import { regionMaxElevation } from './catalog'

describe('высота пиков по размеру страны', () => {
  it('Россия — потолок 900 км, Казахстан ~450 км, Армения — не меньше 60 км', () => {
    const r = (extent_km: number) => ({ iso3: 'X', title: { ru: '', en: '' }, view: {} as never, globe_view: {} as never, outline: '', extent_km })
    expect(regionMaxElevation(r(9097))).toBe(900_000)
    expect(regionMaxElevation(r(3042))).toBeCloseTo(456_300)
    expect(regionMaxElevation(r(270))).toBe(60_000)
    expect(regionMaxElevation(undefined)).toBe(900_000)
  })
})

import { divergeT, divergeValue } from './scale'
const await_import = () => ({ divergeValue })

describe('разница: расходящаяся шкала', () => {
  it('0 — середина, рост — к красному краю, убыль — к синему, с обрезкой', () => {
    expect(divergeT(0, 100)).toBe(0.5)
    expect(divergeT(100, 100)).toBe(1)
    expect(divergeT(-50, 100)).toBe(0.25)
    expect(divergeT(-500, 100)).toBe(0)
    expect(divergeT(NaN, 100)).toBe(0.5)
  })
  it('нелинейная разница: малый рост заметен (лог), обратная функция сходится', () => {
    expect(divergeT(100, 18000, 'log')).toBeGreaterThan(0.6)        // +100 из 18 000 — уже не «белое»
    expect(divergeT(100, 18000, 'linear')).toBeLessThan(0.51)
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const { divergeValue } = await_import()
      expect(divergeT(divergeValue(t, 18000, 'log'), 18000, 'log')).toBeCloseTo(t, 6)
    }
  })
})

import { countryText } from './labels'
describe('countryText — подпись страны по текущему набору', () => {
  const idn = { iso3: 'IDN', ru: 'Индонезия', en: 'Indonesia', lon: 0, lat: 0, pop: 270e6, density: 144, min_label: 2 } as never
  it('CO₂: число в единицах набора, не плотность населения', () => {
    const t = countryText(idn, 'ru', 'density', 349.5, 'т CO₂/км² в год')
    expect(t.sub).toBe('350 т CO₂/км² в год')
    expect(t.sub).not.toMatch(/чел/)
  })
  it('нет значения по стране — без числа (не подставляем чужое)', () => {
    expect(countryText(idn, 'ru', 'density', null, 'т CO₂/км² в год').sub).toBeUndefined()
  })
  it('разница — со знаком; «население» — население страны; «нет» — без числа', () => {
    expect(countryText(idn, 'ru', 'density', 12.3, 'чел/км²', true).sub).toBe('+12,3 чел/км²')
    expect(countryText(idn, 'ru', 'population', 1, 'x').sub).toBe('270 млн')
    expect(countryText(idn, 'ru', 'none', 1, 'x').sub).toBeUndefined()
    expect(countryText(idn, 'ru', 'population', 1, 'x', false, 120e6).sub).toBe('120 млн')       // год набора, не справочник
    expect(countryText(idn, 'ru', 'population', 1, 'x', true, null).sub).toBeUndefined()        // разница без данных — без числа
  })
})

describe('cityText — население города на карте другого года', () => {
  const msk = { ru: 'Москва', en: 'Moscow', pop: 12.6e6 } as never
  it('1975 / прогноз: помечаем «сейчас»; 2025 — без пометки; режим значения не трогаем', () => {
    expect(cityText(msk, 'ru', 'population', 0, 'чел/км²', true).sub).toBe('12,6 млн · сейчас')
    expect(cityText(msk, 'ru', 'population', 0, 'чел/км²', false).sub).toBe('12,6 млн')
    expect(cityText(msk, 'ru', 'density', 9009, 'чел/км²', true).sub).toBe('9 009 чел/км²')
  })
})
