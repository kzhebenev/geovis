/**
 * Построение 3D-поверхности из сетки плотности: вершины в центрах ячеек
 * (долгота, широта, высота в метрах), треугольники по квадратам сетки,
 * стенки «плиты» по краю маски (как макет страны на столе).
 *
 * Результат — меш для SimpleMeshLayer с _instanced: false (координаты LNGLAT).
 */
import type { Grid } from './grid'
import type { RGB } from './scale'

export interface SurfaceOptions {
  /** Высота вершины, м, по плотности. */
  height: (density: number) => number
  /** Цвет вершины по плотности, 0..255. */
  color: (density: number) => RGB
  /** Подъём всей плиты над землёй, м (0 — без плиты). */
  base: number
  /** Цвет стенок, 0..255 (null — без стенок). */
  wallColor: RGB | null
  /** Ячейки с нулём считаются пустыми (мир без маски: не строить океан). */
  skipZeroTriangles: boolean
}

export interface SurfaceMesh {
  positions: Float32Array // x=lon, y=lat, z=м
  colors: Float32Array    // rgb 0..1
  indices: Uint32Array
  vertexCount: number
  triangleCount: number
  wallQuads: number
}

export function buildSurface(g: Grid, o: SurfaceOptions): SurfaceMesh {
  const { width: w, height: h, res, west, north } = g.meta
  const d = g.data
  const n = w * h
  const valid = (i: number) => Number.isFinite(d[i])

  // индексы вершин только для валидных ячеек
  const vid = new Int32Array(n).fill(-1)
  let nv = 0
  for (let i = 0; i < n; i++) if (valid(i)) vid[i] = nv++

  // треугольники + учёт рёбер для поиска края: h — (r,c)-(r,c+1), v — (r,c)-(r+1,c),
  // d1 — (r,c+1)-(r+1,c), d2 — (r,c)-(r+1,c+1); индекс ребра = индекс левой-верхней ячейки
  const eh = new Uint8Array(n), ev = new Uint8Array(n), ed1 = new Uint8Array(n), ed2 = new Uint8Array(n)
  const tris: number[] = []
  const zero = (i: number) => d[i] === 0
  const pushTri = (a: number, b: number, c: number) => {
    if (o.skipZeroTriangles && zero(a) && zero(b) && zero(c)) return false
    tris.push(vid[a], vid[b], vid[c])
    return true
  }
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const a = r * w + c, b = a + 1, dd = a + w, e = dd + 1
      const va = valid(a), vb = valid(b), vd = valid(dd), ve = valid(e)
      const cnt = +va + +vb + +vd + +ve
      if (cnt < 3) continue
      if (cnt === 4) {
        if (pushTri(a, dd, b)) { ev[a]++; ed1[a]++; eh[a]++ }
        if (pushTri(b, dd, e)) { ed1[a]++; eh[dd]++; ev[b]++ }
      } else if (!va) {
        if (pushTri(b, dd, e)) { ed1[a]++; eh[dd]++; ev[b]++ }
      } else if (!vb) {
        if (pushTri(a, dd, e)) { ev[a]++; eh[dd]++; ed2[a]++ }
      } else if (!vd) {
        if (pushTri(a, e, b)) { ed2[a]++; ev[b]++; eh[a]++ }
      } else {
        if (pushTri(a, dd, b)) { ev[a]++; ed1[a]++; eh[a]++ }
      }
    }
  }

  // рёбра края (принадлежат одному треугольнику) → стенки
  const walls: [number, number][] = []
  if (o.wallColor) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const a = r * w + c
        if (eh[a] === 1) walls.push([a, a + 1])
        if (ev[a] === 1) walls.push([a, a + w])
        if (ed1[a] === 1) walls.push([a + 1, a + w])
        if (ed2[a] === 1) walls.push([a, a + w + 1])
      }
    }
  }

  const total = nv + walls.length * 4
  const positions = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const z = new Float32Array(nv)
  for (let i = 0; i < n; i++) {
    const k = vid[i]
    if (k < 0) continue
    const r = (i / w) | 0, c = i - r * w
    const v = d[i]
    z[k] = o.base + o.height(v)
    positions[k * 3] = west + (c + 0.5) * res
    positions[k * 3 + 1] = north - (r + 0.5) * res
    positions[k * 3 + 2] = z[k]
    const col = o.color(v)
    colors[k * 3] = col[0] / 255; colors[k * 3 + 1] = col[1] / 255; colors[k * 3 + 2] = col[2] / 255
  }

  const indices = new Uint32Array(tris.length + walls.length * 6)
  indices.set(tris)
  let wi = tris.length
  let wv = nv
  for (const [p, q] of walls) {
    const kp = vid[p], kq = vid[q]
    // верх p, верх q, низ q, низ p
    for (const [k, zz] of [[kp, z[kp]], [kq, z[kq]], [kq, 0], [kp, 0]] as const) {
      positions[wv * 3] = positions[k * 3]
      positions[wv * 3 + 1] = positions[k * 3 + 1]
      positions[wv * 3 + 2] = zz
      const wc = o.wallColor!
      colors[wv * 3] = wc[0] / 255; colors[wv * 3 + 1] = wc[1] / 255; colors[wv * 3 + 2] = wc[2] / 255
      wv++
    }
    const s = wv - 4
    indices[wi++] = s; indices[wi++] = s + 1; indices[wi++] = s + 2
    indices[wi++] = s; indices[wi++] = s + 2; indices[wi++] = s + 3
  }

  return { positions, colors, indices, vertexCount: total, triangleCount: indices.length / 3, wallQuads: walls.length }
}
