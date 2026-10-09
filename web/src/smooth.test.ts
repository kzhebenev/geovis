import { describe, expect, it } from 'vitest'
import { finiteMax, gaussianKernel, smoothGrid } from './smooth'

describe('smoothGrid', () => {
  it('ядро нормировано', () => {
    expect(gaussianKernel(2).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })
  it('постоянное поле не меняется (в том числе у края маски)', () => {
    const d = new Float32Array(25).fill(7); d[0] = NaN
    const s = smoothGrid(d, 5, 5, 1.5)
    for (let i = 1; i < 25; i++) expect(s[i]).toBeCloseTo(7, 4)
  })
  it('NaN остаётся NaN (граница страны не размывается наружу)', () => {
    const d = new Float32Array([1, 1, NaN, 1, 1, NaN, NaN, NaN, NaN])
    const s = smoothGrid(d, 3, 3, 1)
    expect(Number.isNaN(s[2])).toBe(true)
    expect(Number.isNaN(s[8])).toBe(true)
    expect(s[0]).toBeCloseTo(1, 4)
  })
  it('пик понижается и расползается, но остаётся максимумом', () => {
    const d = new Float32Array(81); d[40] = 1000
    const s = smoothGrid(d, 9, 9, 1.5)
    expect(s[40]).toBeLessThan(1000)
    expect(s[41]).toBeGreaterThan(0)
    expect(finiteMax(s)).toBe(s[40])
  })
  it('sigma=0 — без изменений', () => {
    const d = new Float32Array([1, 2, 3])
    expect(smoothGrid(d, 3, 1, 0)).toBe(d)
  })
})
