/**
 * Сглаживание сетки гауссовым ядром с учётом маски (normalized convolution):
 * blur(v·m) / blur(m). Пустота за границей страны (NaN) не «съедает» края,
 * ячейки вне маски остаются NaN. Нужно только для формы поверхности —
 * цифры в подписях берутся из исходной сетки.
 */
export function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(r * 2 + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r] }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

function blur1d(src: Float32Array, w: number, h: number, k: Float32Array, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length)
  const r = (k.length - 1) / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = -r; j <= r; j++) {
        const xx = horizontal ? x + j : x
        const yy = horizontal ? y : y + j
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue
        s += src[yy * w + xx] * k[j + r]
      }
      out[y * w + x] = s
    }
  }
  return out
}

export function smoothGrid(data: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return data
  const k = gaussianKernel(sigma)
  const vm = new Float32Array(data.length)
  const m = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    if (Number.isFinite(data[i])) { vm[i] = data[i]; m[i] = 1 }
  }
  const num = blur1d(blur1d(vm, w, h, k, true), w, h, k, false)
  const den = blur1d(blur1d(m, w, h, k, true), w, h, k, false)
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = Number.isFinite(data[i]) ? (den[i] > 1e-6 ? num[i] / den[i] : 0) : NaN
  }
  return out
}

/** Максимум без NaN. */
export function finiteMax(a: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]
  return m
}
