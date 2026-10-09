/** Раскладка подписей на экране: без наложений, крупные — первыми. */

export interface Candidate {
  key: string
  x: number        // экранная точка привязки (низ-центр подписи)
  y: number
  w: number        // размер подписи, px
  h: number
  priority: number // больше — важнее
  visible: boolean // точка в кадре и смотрит на камеру
}

interface Box { x0: number; y0: number; x1: number; y1: number }

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Возвращает ключи подписей, которые можно показать. */
export function placeLabels(items: Candidate[], width: number, height: number, gap = 4): Set<string> {
  const shown = new Set<string>()
  const boxes: Box[] = []
  const sorted = items.filter((c) => c.visible).sort((a, b) => b.priority - a.priority)
  for (const c of sorted) {
    const box = { x0: c.x - c.w / 2 - gap, x1: c.x + c.w / 2 + gap, y0: c.y - c.h - gap, y1: c.y + gap }
    if (box.x1 < 0 || box.x0 > width || box.y1 < 0 || box.y0 > height) continue
    if (boxes.some((b) => overlaps(b, box))) continue
    boxes.push(box)
    shown.add(c.key)
  }
  return shown
}

/**
 * Видна ли точка на сфере из камеры (общие координаты глобуса, центр — в нуле):
 * точка P видна, если вектор к камере смотрит «наружу» от поверхности.
 */
export function facesCamera(p: number[], cam: number[]): boolean {
  const d = [cam[0] - p[0], cam[1] - p[1], cam[2] - p[2]]
  return p[0] * d[0] + p[1] * d[1] + p[2] * d[2] > 0
}
