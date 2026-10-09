import type { PaletteId, ScaleMode } from './settings'

export type RGB = [number, number, number]

/**
 * Нормирует значение в 0..1. min < 0 (температура) сдвигает нижнюю границу шкалы:
 * самое холодное место — у земли, самое тёплое — наверху.
 */
export function normalize(d: number, max: number, mode: ScaleMode, min = 0): number {
  const floor = Math.min(0, min)
  if (floor < 0) { d -= floor; max -= floor }
  if (!(d > 0) || !(max > 0)) return 0
  const v = Math.min(d, max)
  switch (mode) {
    // логарифм в квадрате: сохраняет порядок величин, но не «поднимает» сельскую местность
    case 'log': return (Math.log10(1 + v) / Math.log10(1 + max)) ** 2
    case 'sqrt': return Math.sqrt(v / max)
    case 'linear': return v / max
  }
}

/** Обратная к normalize: доля шкалы t ∈ [0,1] → значение (для подписей легенды). */
export function denormalize(t: number, max: number, mode: ScaleMode, min = 0): number {
  const floor = Math.min(0, min)
  const span = max - floor
  const x = Math.max(0, Math.min(1, t))
  let v: number
  switch (mode) {
    case 'log': v = 10 ** (Math.sqrt(x) * Math.log10(1 + span)) - 1; break
    case 'sqrt': v = x * x * span; break
    case 'linear': v = x * span; break
  }
  return v + floor
}

export const PALETTES: Record<PaletteId, RGB[]> = {
  // расходящаяся: убыль — синий, без изменений — светлый, рост — красный (для разницы наборов)
  diverge: [[33, 102, 172], [103, 169, 207], [240, 240, 240], [239, 138, 98], [178, 24, 43]],
  // как на макете: бирюзовая основа → зелёный → жёлтый → красные вершины
  relief: [[52, 128, 140], [86, 170, 140], [150, 200, 100], [246, 214, 72], [214, 74, 64]],
  inferno: [[20, 11, 52], [120, 28, 109], [207, 68, 70], [251, 155, 6], [252, 255, 164]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  neon: [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]],
  ice: [[8, 29, 88], [34, 94, 168], [65, 182, 196], [161, 218, 180], [255, 255, 255]],
}

/** Линейная интерполяция по опорным цветам палитры, t ∈ [0,1]. */
export function colorAt(t: number, palette: RGB[]): RGB {
  const x = Math.max(0, Math.min(1, t)) * (palette.length - 1)
  const i = Math.min(Math.floor(x), palette.length - 2)
  const f = x - i
  const a = palette[i], b = palette[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** Высота самой плотной точки, м, при height=1: мир — ~8% радиуса Земли; страна-макет — выше. */
export const MAX_ELEVATION_M = 500_000
export const MAX_ELEVATION_REGION_M = 900_000

/** Разница: значение → доля палитры (0 — сильная убыль, 0.5 — без изменений, 1 — сильный рост).
 *  Модуль изменения — по той же шкале, что высота (лог/корень/линейная): иначе малые изменения сливаются в белое. */
export function divergeT(d: number, maxAbs: number, mode: ScaleMode = 'linear'): number {
  if (!(maxAbs > 0) || !Number.isFinite(d) || d === 0) return 0.5
  return 0.5 + Math.sign(d) * normalize(Math.abs(d), maxAbs, mode) / 2
}

/** Обратная к divergeT — подписи расходящейся легенды. */
export function divergeValue(t: number, maxAbs: number, mode: ScaleMode = 'linear'): number {
  const x = Math.max(0, Math.min(1, t))
  if (x === 0.5) return 0
  return Math.sign(x - 0.5) * denormalize(Math.abs(x - 0.5) * 2, maxAbs, mode)
}
