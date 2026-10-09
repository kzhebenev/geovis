export interface GridMeta {
  file: string
  res: number
  width: number
  height: number
  west: number
  north: number
  total_population: number | null
  min_value?: number
  max_density: number
  p99_density: number
}

export interface Grid {
  name: string
  meta: GridMeta
  data: Float32Array // плотность чел/км², строки с севера
}

export interface Cells {
  n: number
  lon: Float32Array
  lat: Float32Array
  density: Float32Array
}

export async function loadGrid(base: string, name: string): Promise<Grid> {
  const meta: GridMeta = await (await fetch(`${base}/${name}.json`)).json()
  const buf = await (await fetch(`${base}/${meta.file}`)).arrayBuffer()
  const data = new Float32Array(buf)
  if (data.length !== meta.width * meta.height) {
    throw new Error(`${name}: ожидалось ${meta.width * meta.height} ячеек, получено ${data.length}`)
  }
  return { name, meta, data }
}

/** Непустые ячейки (плотность > minDensity) — центры и значения. */
export function toCells(g: Grid, minDensity = 0.5): Cells {
  const { width, height, res, west, north } = g.meta
  let n = 0
  for (let i = 0; i < g.data.length; i++) if (g.data[i] > minDensity) n++
  const lon = new Float32Array(n), lat = new Float32Array(n), density = new Float32Array(n)
  let k = 0
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const v = g.data[r * width + c]
      if (v > minDensity) {
        lon[k] = west + (c + 0.5) * res
        lat[k] = north - (r + 0.5) * res
        density[k] = v
        k++
      }
    }
  }
  return { n, lon, lat, density }
}

/** Плотность в ячейке, куда попадает точка. */
export function sampleDensity(g: Grid, lon: number, lat: number): number {
  const { width, height, res, west, north } = g.meta
  const r = Math.min(height - 1, Math.max(0, Math.floor((north - lat) / res)))
  const c = Math.min(width - 1, Math.max(0, Math.floor((lon - west) / res)))
  return g.data[r * width + c]
}
