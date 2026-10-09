/**
 * Сценарий полёта камеры: ключевые кадры во времени → камера, настройки сцены и титры
 * в любой момент t. Чистые функции: одинаковое t даёт одинаковый кадр (основа записи видео).
 */
import type { Settings } from './settings'
import type { Camera } from './urlstate'

export type Easing = 'linear' | 'inOutCubic' | 'inOutSine' | 'outCubic'

export interface Keyframe {
  t: number                    // секунда, в которую камера приходит в этот ракурс
  camera: Camera
  easing?: Easing              // как камера летит К этому кадру (по умолчанию inOutCubic)
  arc?: boolean                // перелёт «по дуге» (подъём и снижение) — по умолчанию для дальних
  settings?: Partial<Settings> // смена сцены в момент t (набор/год, фокус, вид, тема, подписи…)
  caption?: { ru?: string; en?: string } | null   // титр с момента t (null — убрать)
}

export interface Scenario {
  id: string
  title: { ru: string; en: string }
  keyframes: Keyframe[]
}

const EASE: Record<Easing, (x: number) => number> = {
  linear: (x) => x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outCubic: (x) => 1 - (1 - x) ** 3,
}

/** Кратчайшая разница углов (−180…180]: поворот через 0°/360° не делает лишний круг. */
export function angleDelta(a: number, b: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180
  if (d === -180) d = 180
  return d
}

/** Угловое расстояние между точками, градусы (для решения, нужна ли дуга). */
export function arcDistance(a: Camera, b: Camera): number {
  const r = Math.PI / 180
  const c = Math.sin(a.latitude * r) * Math.sin(b.latitude * r) +
    Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.cos((b.longitude - a.longitude) * r)
  return Math.acos(Math.max(-1, Math.min(1, c))) / r
}

export function duration(s: Scenario): number {
  return s.keyframes.length ? s.keyframes[s.keyframes.length - 1].t : 0
}

/** Камера в момент t. До первого кадра — первый, после последнего — последний. */
export function cameraAt(s: Scenario, t: number): Camera {
  const k = s.keyframes
  if (!k.length) throw new Error('сценарий без кадров')
  if (t <= k[0].t) return { ...k[0].camera }
  if (t >= k[k.length - 1].t) return { ...k[k.length - 1].camera }
  let i = 1
  while (k[i].t < t) i++
  const a = k[i - 1], b = k[i]
  const span = b.t - a.t
  const u = span > 0 ? (t - a.t) / span : 1
  const e = EASE[b.easing ?? 'inOutCubic'](u)
  const A = a.camera, B = b.camera
  const lerp = (x: number, y: number) => x + (y - x) * e
  let zoom = lerp(A.zoom, B.zoom)
  // дуга: при дальнем перелёте камера поднимается (зум меньше) и снова снижается
  const dist = arcDistance(A, B)
  if (b.arc ?? dist > 25) {
    const lift = Math.min(2.5, dist / 40) + Math.max(0, Math.min(A.zoom, B.zoom) - 2) * 0.6
    zoom -= lift * Math.sin(Math.PI * e)
  }
  return {
    longitude: A.longitude + angleDelta(A.longitude, B.longitude) * e,
    latitude: lerp(A.latitude, B.latitude),
    zoom: Math.max(0.3, zoom),
    pitch: lerp(A.pitch, B.pitch),
    bearing: A.bearing + angleDelta(A.bearing, B.bearing) * e,
  }
}

/** Числовые настройки, которые меняются плавно между кадрами (как камера), а не скачком. */
const SMOOTH_KEYS = ['seriesYear', 'height'] as const

/** Накопленные настройки сцены к моменту t (смены применяются в момент своего кадра;
 *  seriesYear и height плавно интерполируются между соседними кадрами, где они заданы). */
export function settingsAt(s: Scenario, t: number): Partial<Settings> {
  const out: Partial<Settings> = {}
  for (const k of s.keyframes) {
    if (k.t > t) break
    if (k.settings) Object.assign(out, k.settings)
  }
  for (const key of SMOOTH_KEYS) {
    const prev = [...s.keyframes].reverse().find((k) => k.t <= t && typeof k.settings?.[key] === 'number')
    const next = s.keyframes.find((k) => k.t > t && typeof k.settings?.[key] === 'number')
    if (prev && next && next.t > prev.t) {
      const a = prev.settings![key] as number, b = next.settings![key] as number
      const u = (t - prev.t) / (next.t - prev.t)
      ;(out as Record<string, unknown>)[key] = a + (b - a) * u
    }
  }
  return out
}

/** Титр в момент t и время его появления (для плавного проявления). */
export function captionAt(s: Scenario, t: number): { text: { ru?: string; en?: string }; since: number } | null {
  let cur: { text: { ru?: string; en?: string }; since: number } | null = null
  for (const k of s.keyframes) {
    if (k.t > t) break
    if (k.caption === null) cur = null
    else if (k.caption) cur = { text: k.caption, since: k.t }
  }
  return cur
}

/** Проверка сценария (импорт JSON): понятная ошибка вместо «молча не летит». */
export function validateScenario(x: unknown): Scenario {
  const s = x as Scenario
  if (!s || typeof s !== 'object' || !Array.isArray(s.keyframes)) throw new Error('нет keyframes')
  if (s.keyframes.length < 1) throw new Error('нужен хотя бы один кадр')
  let prev = -Infinity
  s.keyframes.forEach((k, i) => {
    const c = k?.camera
    if (typeof k?.t !== 'number' || !Number.isFinite(k.t) || k.t < 0) throw new Error(`кадр ${i + 1}: t ≥ 0`)
    if (k.t < prev) throw new Error(`кадр ${i + 1}: время меньше предыдущего`)
    prev = k.t
    if (!c || ![c.longitude, c.latitude, c.zoom, c.pitch, c.bearing].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error(`кадр ${i + 1}: camera {longitude, latitude, zoom, pitch, bearing}`)
    }
    if (Math.abs(c.latitude) > 85 || c.zoom < 0 || c.zoom > 12 || c.pitch < 0 || c.pitch > 85) {
      throw new Error(`кадр ${i + 1}: камера вне допустимого диапазона`)
    }
    if (k.easing && !(k.easing in EASE)) throw new Error(`кадр ${i + 1}: easing ∈ ${Object.keys(EASE).join(', ')}`)
  })
  return { id: s.id || 'custom', title: s.title || { ru: 'Свой сценарий', en: 'Custom scenario' }, keyframes: s.keyframes }
}
