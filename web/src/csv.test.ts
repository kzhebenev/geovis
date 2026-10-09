import { describe, expect, it } from 'vitest'
import { detect, num, parseTable } from './csv'

const C = [{ code: 'RUS', ru: 'Россия', en: 'Russia' }, { code: 'KAZ', ru: 'Казахстан', en: 'Kazakhstan' },
  { code: 'CHN', ru: 'Китай', en: 'China' }]
const R = [{ code: 'RU-MOW', ru: 'Москва', en: 'Moscow' }, { code: 'RU-TA', ru: 'Татарстан', en: 'Tatarstan' }]

describe('parseTable / num', () => {
  it('русский Excel: «;» и десятичная запятая, пробелы-разделители тысяч', () => {
    const t = parseTable('Страна;Значение\nРоссия;1 234,5\nКитай;"12 000"\n')
    expect(t.headers).toEqual(['Страна', 'Значение'])
    expect(t.rows.map((r) => num(r[1]))).toEqual([1234.5, 12000])
  })
  it('вставка из Excel (табуляция) и кавычки с запятыми внутри', () => {
    const t = parseTable('name\tvalue\n"Moscow, city"\t5\r\nKazan\t7')
    expect(t.rows).toEqual([['Moscow, city', '5'], ['Kazan', '7']])
  })
  it('num: проценты, валюта, мусор', () => {
    expect(num('12%')).toBe(12); expect(num('$1,250.50')).toBe(1250.5); expect(num('1,5')).toBe(1.5)
    expect(num('1,234,567')).toBe(1234567); expect(num('-3.5')).toBe(-3.5)
    expect(num('нет данных')).toBeNull(); expect(num('')).toBeNull()
  })
})

describe('detect', () => {
  it('страны названиями RU/EN и кодами, с годами', () => {
    const p = detect(parseTable('country,year,value\nРоссия,2015,1\nKazakhstan,2015,2\nCHN,2024,3\nАтлантида,2024,9'), C, R)
    expect(p.kind).toBe('countries')
    expect(p.items).toEqual([{ iso3: 'RUS', value: 1, year: 2015 }, { iso3: 'KAZ', value: 2, year: 2015 }, { iso3: 'CHN', value: 3, year: 2024 }])
    expect(p.unmatched).toEqual(['Атлантида'])            // негатив: не выдумываем страну
    expect(p.years).toEqual([2015, 2024])
  })
  it('регионы: по коду ISO 3166-2 или названию', () => {
    const p = detect(parseTable('регион;значение\nRU-MOW;10\nТатарстан;4\nНарния;1'), C, R)
    expect(p.kind).toBe('regions')
    expect(p.items).toEqual([{ code: 'RU-MOW', value: 10 }, { code: 'RU-TA', value: 4 }])
    expect(p.unmatched).toEqual(['Нарния'])
  })
  it('точки: широта/долгота, подпись, значение; кривые координаты пропускаются', () => {
    const p = detect(parseTable('Город;Широта;Долгота;Выручка\nМосква;55,75;37,62;100\nОшибка;95;10;1\nБез числа;;;'), C, R)
    expect(p.kind).toBe('points')
    expect(p.items).toEqual([{ lat: 55.75, lon: 37.62, value: 100, label: 'Москва' }])
    expect(p.skipped).toBe(2)
  })
})

import { pointsToGrid, toSeriesJson } from './csv'

describe('расчёты как в API', () => {
  it('ряд по странам: последний год, общая шкала', () => {
    const j = toSeriesJson([{ iso3: 'RUS', value: 1, year: 2015 }, { iso3: 'RUS', value: 3, year: 2024 }, { iso3: 'KAZ', value: 2, year: 2015 }], 'iso3')
    expect(j.years).toEqual([2015, 2024])
    expect(j.values).toEqual([{ iso3: 'RUS', value: 3, year: 2024 }, { iso3: 'KAZ', value: 2, year: 2015 }])
    expect([j.min_value, j.max_value]).toEqual([1, 3])
  })
  it('точки в одной ячейке суммируются, остальное пусто', () => {
    const g = pointsToGrid([{ lat: 55.75, lon: 37.62, value: 100 }, { lat: 55.7, lon: 37.5, value: 50 }, { lat: 59.9, lon: 30.3, value: 30 }], 1)
    const vals = [...g.data].filter(Number.isFinite).sort((a, b) => a - b)
    expect(vals).toEqual([30, 150]); expect(g.meta.total_population).toBe(180)
  })
})
