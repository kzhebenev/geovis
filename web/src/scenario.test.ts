import { describe, expect, it } from 'vitest'
import { angleDelta, cameraAt, captionAt, duration, settingsAt, validateScenario, type Scenario } from './scenario'
import { SCENARIOS } from './scenarios'

const cam = (longitude: number, latitude: number, zoom = 3, pitch = 0, bearing = 0) => ({ longitude, latitude, zoom, pitch, bearing })
const S: Scenario = {
  id: 't', title: { ru: '', en: '' },
  keyframes: [
    { t: 0, camera: cam(10, 50), settings: { dataset: 'pop1975', theme: 'dark' }, caption: { ru: 'старт' } },
    { t: 10, camera: cam(20, 50, 5, 40, 90), easing: 'linear', settings: { dataset: 'pop2025' } },
    { t: 20, camera: cam(20, 50, 5, 40, 90), caption: null },
  ],
}

describe('сценарий полёта', () => {
  it('ключевые кадры достигаются точно, до/после — крайние', () => {
    expect(cameraAt(S, 0)).toEqual(cam(10, 50))
    expect(cameraAt(S, 10)).toEqual(cam(20, 50, 5, 40, 90))
    expect(cameraAt(S, -5)).toEqual(cam(10, 50))
    expect(cameraAt(S, 99)).toEqual(cam(20, 50, 5, 40, 90))
  })
  it('linear: середина пути — середина значений (короткий перелёт без дуги)', () => {
    const c = cameraAt(S, 5)
    expect(c.longitude).toBeCloseTo(15); expect(c.zoom).toBeCloseTo(4); expect(c.pitch).toBeCloseTo(20); expect(c.bearing).toBeCloseTo(45)
  })
  it('детерминированность: одно и то же t — одна и та же камера', () => {
    expect(cameraAt(S, 3.3)).toEqual(cameraAt(S, 3.3))
  })
  it('дальний перелёт идёт по дуге: в середине камера выше (зум меньше) обоих концов', () => {
    const far: Scenario = { ...S, keyframes: [{ t: 0, camera: cam(-70, 40, 4) }, { t: 10, camera: cam(120, 30, 4) }] }
    expect(cameraAt(far, 5).zoom).toBeLessThan(3)
  })
  it('поворот и долгота — кратчайшим путём через 0°/180°', () => {
    expect(angleDelta(350, 10)).toBe(20)
    expect(angleDelta(10, 350)).toBe(-20)
    const wrap: Scenario = { ...S, keyframes: [{ t: 0, camera: cam(170, 60) }, { t: 10, camera: cam(-170, 60), easing: 'linear', arc: false }] }
    expect(cameraAt(wrap, 5).longitude).toBeCloseTo(180)   // через антимеридиан, а не через Гринвич
  })
  it('настройки сцены накапливаются и меняются в момент кадра', () => {
    expect(settingsAt(S, 0)).toEqual({ dataset: 'pop1975', theme: 'dark' })
    expect(settingsAt(S, 9.99).dataset).toBe('pop1975')
    expect(settingsAt(S, 10)).toEqual({ dataset: 'pop2025', theme: 'dark' })
  })
  it('титр держится до явного снятия', () => {
    expect(captionAt(S, 5)?.text.ru).toBe('старт')
    expect(captionAt(S, 20)).toBeNull()
  })
  it('валидация: понятные ошибки на кривом JSON', () => {
    expect(() => validateScenario({})).toThrow(/keyframes/)
    expect(() => validateScenario({ keyframes: [{ t: 5, camera: cam(0, 0) }, { t: 1, camera: cam(0, 0) }] })).toThrow(/меньше/)
    expect(() => validateScenario({ keyframes: [{ t: 0, camera: cam(0, 95) }] })).toThrow(/диапазона/)
    expect(() => validateScenario({ keyframes: [{ t: 0, camera: { longitude: 0 } }] })).toThrow(/camera/)
    expect(validateScenario({ keyframes: [{ t: 0, camera: cam(0, 0) }] }).id).toBe('custom')
  })
  it('все готовые сценарии корректны и длятся 20–60 с', () => {
    for (const s of SCENARIOS) {
      expect(() => validateScenario(s)).not.toThrow()
      expect(duration(s)).toBeGreaterThan(20); expect(duration(s)).toBeLessThan(60)
    }
  })
})

describe('плавные числовые настройки', () => {
  const S2: Scenario = { id: 'y', title: { ru: '', en: '' }, keyframes: [
    { t: 0, camera: cam(0, 0), settings: { seriesYear: 1975, dataset: 'pop1975' } },
    { t: 10, camera: cam(0, 0), settings: { seriesYear: 2025 } },
    { t: 20, camera: cam(0, 0), settings: { seriesYear: 2100 } }] }
  it('seriesYear интерполируется между кадрами, а не скачет', () => {
    expect(settingsAt(S2, 0).seriesYear).toBe(1975)
    expect(settingsAt(S2, 5).seriesYear).toBeCloseTo(2000)
    expect(settingsAt(S2, 15).seriesYear).toBeCloseTo(2062.5)
    expect(settingsAt(S2, 25).seriesYear).toBe(2100)
    expect(settingsAt(S2, 5).dataset).toBe('pop1975')   // нечисловые — по-прежнему скачком
  })
})
