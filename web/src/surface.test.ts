import { describe, expect, it } from 'vitest'
import { buildSurface, type SurfaceOptions } from './surface'
import type { Grid } from './grid'

const grid = (w: number, h: number, vals: number[]): Grid => ({
  name: 't',
  meta: { file: '', res: 1, width: w, height: h, west: 10, north: 50, total_population: 0, max_density: 9, p99_density: 9 },
  data: new Float32Array(vals),
})
const opts: SurfaceOptions = {
  height: (d) => d * 1000, color: () => [255, 0, 0], base: 100, wallColor: [0, 0, 255], skipZeroTriangles: false,
}

describe('buildSurface', () => {
  it('3×3 без дыр: 8 треугольников, по периметру 8 стенок', () => {
    const m = buildSurface(grid(3, 3, [1, 1, 1, 1, 5, 1, 1, 1, 1]), opts)
    expect(m.triangleCount - m.wallQuads * 2).toBe(8)
    expect(m.wallQuads).toBe(8)
  })
  it('вершины в центрах ячеек, высота = база + h(плотность)', () => {
    const m = buildSurface(grid(3, 3, [1, 1, 1, 1, 5, 1, 1, 1, 1]), opts)
    // центральная ячейка: индекс вершины 4 → (11.5, 48.5, 100 + 5000)
    expect(Array.from(m.positions.slice(12, 15))).toEqual([11.5, 48.5, 5100])
    expect(Array.from(m.colors.slice(0, 3))).toEqual([1, 0, 0])
  })
  it('дыра (NaN) в центре: 4 треугольника, край = 8 внешних + 4 внутренних ребра', () => {
    const m = buildSurface(grid(3, 3, [1, 1, 1, 1, NaN, 1, 1, 1, 1]), opts)
    expect(m.triangleCount - m.wallQuads * 2).toBe(4)
    expect(m.wallQuads).toBe(12)
  })
  it('стенки опускаются до земли (z=0) и красятся цветом стенок', () => {
    const m = buildSurface(grid(2, 2, [1, 1, 1, 1]), opts)
    const nv = 4
    const wallZ = Array.from({ length: m.wallQuads * 4 }, (_, i) => m.positions[(nv + i) * 3 + 2])
    expect(wallZ.filter((z) => z === 0).length).toBe(m.wallQuads * 2)
    expect(Array.from(m.colors.slice(nv * 3, nv * 3 + 3))).toEqual([0, 0, 1])
  })
  it('негатив: одиночная ячейка и пустая маска — ни одного треугольника', () => {
    expect(buildSurface(grid(2, 2, [1, NaN, NaN, NaN]), opts).triangleCount).toBe(0)
    expect(buildSurface(grid(2, 2, [NaN, NaN, NaN, NaN]), opts).vertexCount).toBe(0)
  })
  it('мир без маски: океан (нули) не строится', () => {
    const o = { ...opts, skipZeroTriangles: true, wallColor: null }
    expect(buildSurface(grid(3, 3, [0, 0, 0, 0, 0, 0, 0, 0, 0]), o).triangleCount).toBe(0)
    // 8 треугольников квадратов, 2 угловых — целиком из нулей
    expect(buildSurface(grid(3, 3, [0, 0, 0, 0, 7, 0, 0, 0, 0]), o).triangleCount).toBe(6)
  })
  it('индексы не выходят за число вершин', () => {
    const m = buildSurface(grid(3, 3, [1, 1, 1, 1, NaN, 1, 1, 1, 1]), opts)
    expect(Math.max(...m.indices)).toBeLessThan(m.vertexCount)
  })
})
