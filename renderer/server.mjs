// GeoVis renderer: статичный PNG-снимок сцены (для Telegram/MAX/.docx, где iframe не работает).
//   GET /render?<параметры ссылки сайта>&w=1200&h=675 → image/png
// Доступен только внутри compose-сети: параметры проверяет API (белый список), сюда их передаёт он.
import http from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'

const TARGET = (process.env.GEOVIS_TARGET || 'http://geovis').replace(/\/$/, '')
const CACHE = process.env.CACHE_DIR || '/cache'
const PORT = Number(process.env.PORT || 8200)
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 2)
const TTL_BUILTIN_H = Number(process.env.TTL_BUILTIN_H || 24)

// отпечаток сайта (сборка web + каталог данных): после релиза или пересборки наборов старые снимки не отдаются
let stamp = { at: 0, v: '' }
async function siteStamp(fetchFn = fetch, now = Date.now()) {
  if (now - stamp.at < 60e3) return stamp.v
  const head = async (path) => {
    try {
      const r = await fetchFn(`${TARGET}${path}`, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      return `${r.headers.get('etag') ?? ''}${r.headers.get('last-modified') ?? ''}`
    } catch { return null }
  }
  const parts = await Promise.all([head('/'), head('/data/catalog.json')])
  if (parts.includes(null)) return stamp.v          // web недоступен — прежний отпечаток, без сброса кеша
  stamp = { at: now, v: parts.join('|') }
  return stamp.v
}
const TTL_DATASET_H = Number(process.env.TTL_DATASET_H || 24 * 30)
await mkdir(CACHE, { recursive: true })
const VIDEOS = `${CACHE}/videos`
await mkdir(VIDEOS, { recursive: true })
const VIDEO_TTL_D = Number(process.env.VIDEO_TTL_D || 7)
const MAX_QUEUE = Number(process.env.MAX_QUEUE || 3)

let browser = null
async function getBrowser() {
  if (browser?.connected) return browser
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--hide-scrollbars', '--font-render-hinting=none'],
  })
  return browser
}

// простая очередь: не больше MAX_PARALLEL рендеров одновременно
let active = 0
const waiting = []
const acquire = () => new Promise((r) => { if (active < MAX_PARALLEL) { active++; r() } else waiting.push(r) })
const release = () => { const n = waiting.shift(); if (n) n(); else active-- }

async function render(query, w, h) {
  await acquire()
  const page = await (await getBrowser()).newPage()
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
    const url = `${TARGET}/?${query}${query ? '&' : ''}embed=1`
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.waitForFunction(() => window.__geovis?.ready || document.querySelector('[data-testid=error]'),
      { timeout: 90000, polling: 250 })
    const err = await page.$eval('[data-testid=error]', (e) => e.textContent).catch(() => null)
    if (err) { const e = new Error(err); e.status = /не найден/.test(err) ? 404 : 422; throw e }
    await page.evaluate(() => document.fonts.ready)
    await new Promise((r) => setTimeout(r, 1500))   // подписи проявляются ~300 мс, кадр WebGL дорисовывается
    return await page.screenshot({ type: 'png' })
  } finally {
    await page.close().catch(() => {})
    release()
  }
}

// ---------- видео: покадровый рендер сценария → MP4 (H.264) ----------
const jobs = new Map()   // id → { state, frame, frames, fps, w, h, error, started, finished }
const queue = []
let busy = false

const waitFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

async function renderVideo(id, { scenario, fps, w, h }) {
  const job = jobs.get(id)
  job.state = 'rendering'; job.started = Date.now()
  const out = `${VIDEOS}/${id}.mp4`
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${out}.tmp.mp4`])
  let ffErr = ''
  ff.stderr.on('data', (d) => { ffErr += d })
  const ffDone = new Promise((r) => ff.on('close', r))
  await acquire()
  const page = await (await getBrowser()).newPage()
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
    await page.goto(`${TARGET}/?embed=1&render=1`, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000, polling: 250 })
    await page.evaluate((sc) => window.__geovis.loadScenario(sc), scenario)
    const err = await page.$eval('[data-testid=error]', (e) => e.textContent).catch(() => null)
    if (err) throw new Error(err)
    const dur = await page.evaluate(() => window.__geovis.scenario.duration)
    job.frames = Math.max(1, Math.round(dur * fps) + 1)
    await page.evaluate(() => document.fonts.ready)
    for (let i = 0; i < job.frames; i++) {
      if (job.cancel) throw new Error('отменено')
      await page.evaluate((t) => window.__geovis.seek(t), i / fps)
      await waitFrame(page)
      await page.waitForFunction(() => window.__geovis?.ready, { timeout: 120000, polling: 100 })
      await waitFrame(page)
      const jpg = await page.screenshot({ type: 'jpeg', quality: 92 })
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
      job.frame = i + 1
    }
    ff.stdin.end()
    const code = await ffDone
    if (code !== 0) throw new Error(`ffmpeg: ${ffErr.slice(0, 300)}`)
    await rename(`${out}.tmp.mp4`, out)
    job.state = 'done'; job.finished = Date.now(); job.bytes = (await stat(out)).size
  } catch (e) {
    ff.stdin.destroy(); ff.kill('SIGKILL')
    job.state = 'error'; job.error = e.message; job.finished = Date.now()
    await rm(`${out}.tmp.mp4`, { force: true })
    console.error(`video ${id}: ${e.message}`)
  } finally {
    await page.close().catch(() => {})
    release()
  }
}

async function pump() {
  if (busy) return
  const next = queue.shift()
  if (!next) return
  busy = true
  try { await renderVideo(next.id, next.spec) } finally { busy = false; pump() }
}

async function cleanupVideos() {
  for (const f of await readdir(VIDEOS).catch(() => [])) {
    const st = await stat(`${VIDEOS}/${f}`).catch(() => null)
    if (st && Date.now() - st.mtimeMs > VIDEO_TTL_D * 86400e3) await rm(`${VIDEOS}/${f}`, { force: true })
  }
  for (const [id, j] of jobs) if (j.finished && Date.now() - j.finished > VIDEO_TTL_D * 86400e3) jobs.delete(id)
}
setInterval(cleanupVideos, 3600e3)

const readBody = (req) => new Promise((resolve, reject) => {
  let b = ''; req.on('data', (d) => { b += d; if (b.length > 2e6) reject(new Error('слишком большой сценарий')) })
  req.on('end', () => resolve(b)); req.on('error', reject)
})

function jobView(id, j) {
  const pos = queue.findIndex((q) => q.id === id)
  const elapsed = j.started ? (Date.now() - j.started) / 1000 : 0
  const eta = j.state === 'rendering' && j.frame > 5 ? Math.round(elapsed / j.frame * (j.frames - j.frame)) : null
  return { id, state: j.state, frame: j.frame, frames: j.frames, fps: j.fps, w: j.w, h: j.h, queue_position: pos >= 0 ? pos + 1 : 0,
    eta_s: eta, error: j.error ?? null, bytes: j.bytes ?? null }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/health' || u.pathname === '/healthz') { res.end('ok'); return }   // healthz — для k8s
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
  if (u.pathname === '/video' && req.method === 'POST') {
    try {
      const spec = JSON.parse(await readBody(req))
      const waiting = queue.length + (busy ? 1 : 0)
      if (waiting > MAX_QUEUE) return json(429, { detail: `очередь занята (${waiting}), попробуйте позже` })
      const id = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x')
      jobs.set(id, { state: 'queued', frame: 0, frames: 0, fps: spec.fps, w: spec.w, h: spec.h })
      queue.push({ id, spec }); pump()
      return json(202, jobView(id, jobs.get(id)))
    } catch (e) { return json(400, { detail: e.message }) }
  }
  const m = u.pathname.match(/^\/video\/([A-Za-z0-9]{6,32})(\.mp4)?$/)
  if (m) {
    const j = jobs.get(m[1])
    if (!j) return json(404, { detail: 'видео не найдено' })
    if (!m[2]) return json(200, jobView(m[1], j))
    if (j.state !== 'done') return json(409, { detail: `видео ещё не готово: ${j.state}` })
    const file = `${VIDEOS}/${m[1]}.mp4`
    const st = await stat(file).catch(() => null)
    if (!st) return json(404, { detail: 'файл удалён' })
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': st.size })
    createReadStream(file).pipe(res)
    return
  }
  if (u.pathname !== '/render') { res.statusCode = 404; res.end(); return }
  const w = Math.min(1920, Math.max(320, Number(u.searchParams.get('w')) || 1200))
  const h = Math.min(1080, Math.max(240, Number(u.searchParams.get('h')) || 675))
  u.searchParams.delete('w'); u.searchParams.delete('h')
  u.searchParams.sort()
  const query = u.searchParams.toString()
  const key = createHash('sha1').update(`${query}|${w}x${h}|${await siteStamp()}`).digest('hex')
  const file = `${CACHE}/${key}.png`
  const ttl = (u.searchParams.has('ds') ? TTL_DATASET_H : TTL_BUILTIN_H) * 3600e3
  const t0 = Date.now()
  try {
    let png
    try {
      const st = await stat(file)
      if (Date.now() - st.mtimeMs < ttl) png = await readFile(file)
    } catch { /* нет в кеше */ }
    const cached = Boolean(png)
    if (!png) {
      png = await render(query, w, h)
      await writeFile(`${file}.tmp`, png); await rename(`${file}.tmp`, file)
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'X-Cache': cached ? 'hit' : 'miss',
      'X-Render-Ms': String(Date.now() - t0) })
    res.end(png)
  } catch (e) {
    console.error(`render ${query}: ${e.message}`)
    res.writeHead(e.status || 500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ detail: e.message }))
  }
}).listen(PORT, () => console.log(`renderer :${PORT} → ${TARGET}`))
