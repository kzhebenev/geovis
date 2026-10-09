// Сценарии полёта камеры в реальном Chrome.
//   node e2e/scenario.e2e.mjs [BASE_URL] [папка-скриншотов]
// Проверяет: запуск по ссылке, титры и смену сцены по ходу полёта, детерминированность кадра
// (одно t → один и тот же кадр — основа записи видео), реальное воспроизведение, паузу при ручном
// управлении, редактор кадров и импорт с понятной ошибкой; 0 JS-ошибок.
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = (process.argv[2] || 'http://localhost:4317').replace(/\/$/, '')
const OUT = process.argv[3] || 'e2e/shots-scenario'
mkdirSync(OUT, { recursive: true })
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const diff = (a, b) => {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b); let d = 0
  for (let i = 0; i < pa.data.length; i += 4) {
    if (Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]) > 30) d++
  }
  return d / (pa.width * pa.height)
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 800 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const g = (fn, ...a) => page.evaluate(fn, ...a)
async function seekAndShot(t, name) {
  await g((tt) => window.__geovis.seek(tt), t)
  await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })
  await sleep(2500)
  const b = await page.screenshot({ type: 'png' })
  if (name) writeFileSync(`${OUT}/${name}.png`, b)
  return b
}

try {
  // 1. Запуск по ссылке: сценарий «Россия: из космоса к Москве»
  await page.goto(`${BASE}/?scenario=russia-moscow`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.scenario, { timeout: 90000 })
  const st0 = await g(() => window.__geovis.scenario)
  check(st0.id === 'russia-moscow' && st0.duration > 30, `сценарий по ссылке: ${st0.id}, ${st0.duration} с`)
  await g(() => window.__geovis.setSettings({ showPanel: false }))
  const s0 = await seekAndShot(0, '01-rus-t0')
  const sett = await g(() => window.__geovis.settings)
  check(sett.focus === 'RUS' && sett.mode === 'surface' && sett.theme === 'light', 'сцена сценария применена (фокус RUS, поверхность, светлая)')
  const cap0 = await page.$eval('[data-testid=caption]', (e) => e.textContent).catch(() => '')
  check(/144 миллиона/.test(cap0), `титр в начале: «${cap0}»`)

  const s26 = await seekAndShot(27, '02-rus-moscow')
  const cam = await g(() => window.__geovis.viewState)
  check(Math.abs(cam.longitude - 37.62) < 0.01 && Math.abs(cam.latitude - 55.75) < 0.01 && cam.zoom > 3.6, `t=27: камера у Москвы (${cam.longitude.toFixed(2)}, ${cam.latitude.toFixed(2)}, z${cam.zoom.toFixed(1)})`)
  const cap26 = await page.$eval('[data-testid=caption]', (e) => e.textContent).catch(() => '')
  check(cap26 === 'Москва', `титр у Москвы: «${cap26}»`)
  check(diff(s0, s26) > 0.2, `кадры t=0 и t=27 разные (${(diff(s0, s26) * 100).toFixed(0)}%)`)

  // 2. Детерминированность: тот же момент — тот же кадр (после ухода в другую точку и возврата)
  const a = await seekAndShot(13.37, '03-det-a')
  await seekAndShot(33)
  const b = await seekAndShot(13.37, '03-det-b')
  const d = diff(a, b)
  check(d < 0.002, `детерминированный кадр t=13.37: отличие ${(d * 100).toFixed(3)}%`)
  await g(() => window.__geovis.seek(21.5)); await sleep(300)
  const c1 = await g(() => window.__geovis.viewState)
  await g(() => window.__geovis.seek(5)); await sleep(300)
  await g(() => window.__geovis.seek(21.5)); await sleep(300)
  const c2 = await g(() => window.__geovis.viewState)
  check(JSON.stringify(c1) === JSON.stringify(c2), 'камера в момент t совпадает точно')

  // 3. Смена эпох по ходу полёта: «Рост мегаполисов»
  await g(() => window.__geovis.playScenario('megacities-growth'))
  await g(() => window.__geovis.seek(0))
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.grid?.name.includes('pop1975'), { timeout: 90000 })
  await sleep(2000)
  const y75 = await page.screenshot({ type: 'png' }); writeFileSync(`${OUT}/04-growth-1975.png`, y75)
  // плавный год: t=22 — ровно 2025 (кадр «Сегодня»), t=13 — смесь эпох между 1975 и 2025
  await g(() => window.__geovis.seek(13))
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.grid?.year > 1990 && window.__geovis.grid.year < 2010, { timeout: 90000 })
  const ymid = await g(() => window.__geovis.grid.year)
  check(Math.abs(ymid - (1975 + 50 * 13 / 22)) < 0.05, `плавный год в середине пути: ${ymid.toFixed(2)} ≈ 2004.55`)
  await g(() => window.__geovis.seek(22))
  await page.waitForFunction(() => window.__geovis?.ready && Math.abs((window.__geovis.grid?.year ?? 0) - 2025) < 0.01, { timeout: 90000 })
  await sleep(2000)
  const y25 = await page.screenshot({ type: 'png' }); writeFileSync(`${OUT}/05-growth-2025.png`, y25)
  const cap25 = await page.$eval('[data-testid=caption]', (e) => e.textContent).catch(() => '')
  check(cap25 === 'Сегодня', `титр эпохи: «${cap25}»`)
  const warm = (buf) => { const p = PNG.sync.read(buf); let n = 0
    for (let i = 0; i < p.data.length; i += 4) if (p.data[i] > 200 && p.data[i + 1] > 120 && p.data[i + 2] < 120) n++; return n }
  check(warm(y25) > warm(y75), `к 2025 «горячих» столбиков больше, чем в 1975 (${warm(y25)} > ${warm(y75)})`)
  await g(() => window.__geovis.seek(40))
  await page.waitForFunction(() => window.__geovis?.ready && (window.__geovis.grid?.year ?? 0) > 2025, { timeout: 90000 })
  const yEnd = await g(() => window.__geovis.grid.year)
  check(yEnd === 2100, `конец сценария — прогноз 2100 (год сетки ${yEnd})`)

  // 4. Реальное воспроизведение и пауза при ручном управлении
  // лёгкая сцена (сетка 1°, карта), чтобы частота кадров без видеокарты не мешала проверить часы
  await g(() => window.__geovis.loadScenario({ title: { ru: 'лёгкий', en: 'light' }, keyframes: [
    { t: 0, camera: { longitude: 0, latitude: 30, zoom: 1.5, pitch: 0, bearing: 0 },
      settings: { dataset: 'pop2025', focus: 'world', res: 1, mode: 'columns', projection: 'map', theme: 'dark', countryDataset: null } },
    { t: 20, camera: { longitude: 60, latitude: 30, zoom: 1.5, pitch: 0, bearing: 0 }, easing: 'linear' } ] }))
  await g(() => window.__geovis.setSettings({ showPanel: true }))
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.grid?.name.includes('g_1p0'), { timeout: 60000 })
  await sleep(1000)
  await page.click('[data-testid=play]')
  await page.waitForFunction(() => window.__geovis.scenario?.time > 0.2, { timeout: 60000 })
  const fps0 = await g(() => new Promise((r) => { let n = 0; const s0 = performance.now()
    const f = () => { n++; if (performance.now() - s0 < 1000) requestAnimationFrame(f); else r(n) }; requestAnimationFrame(f) }))
  // без видеокарты кадры бывают по секунде и дольше: ждём продвижения времени до 15 с, а не фиксированное окно
  const p1 = await g(() => window.__geovis.scenario.time)
  const w0 = Date.now()
  let pl = await g(() => window.__geovis.scenario)
  while (pl.time - p1 < 0.05 && Date.now() - w0 < 20000) { await sleep(500); pl = await g(() => window.__geovis.scenario) }
  await sleep(2000); pl = await g(() => window.__geovis.scenario)
  const dt = pl.time - p1, wall = (Date.now() - w0) / 1000
  check(pl.playing && dt > 0 && dt <= wall + 1.2, `воспроизведение: за ${wall.toFixed(1)} с прошло ${dt.toFixed(2)} с сценария (не быстрее реального, ~${fps0} кадр/с)`)
  if (fps0 >= 8) check(dt > wall * 0.6, `при ${fps0} кадр/с полёт идёт почти в реальном времени (${(dt / wall * 100).toFixed(0)}%)`)
  const cam1 = await g(() => window.__geovis.viewState.longitude)
  check(cam1 > 0 && cam1 < 60, `камера движется по сценарию (долгота ${cam1.toFixed(1)})`)
  await g(() => window.__geovis.setSettings({ showPanel: false }))
  await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(800, 450, { steps: 8 }); await page.mouse.up()
  await sleep(300)
  check((await g(() => window.__geovis.scenario.playing)) === false, 'перетаскивание мышью ставит на паузу')

  // 5. Редактор: кадры с текущего ракурса + импорт с ошибкой
  await g(() => window.__geovis.setSettings({ showPanel: true }))
  await sleep(500)
  await g(() => window.__geovis.setViewState({ longitude: 10, latitude: 50, zoom: 3, pitch: 30, bearing: 0 }))
  await page.click('[data-testid=add-keyframe]')
  await g(() => window.__geovis.setViewState({ longitude: 40, latitude: 55, zoom: 4, pitch: 50, bearing: 20 }))
  await page.click('[data-testid=add-keyframe]')
  const cs = await g(() => window.__geovis.scenario)
  // «+ Кадр» дописывает в текущий свой сценарий (лёгкий, 20 с): кадры на 25 и 30 с
  check(cs.id === 'custom' && cs.duration === 30, `свой сценарий дописан: ${cs.id}, ${cs.duration} с`)
  await g(() => window.__geovis.seek(27.5)); await sleep(300)
  const mid = await g(() => window.__geovis.viewState)
  check(mid.longitude > 10 && mid.longitude < 40, `свой сценарий интерполирует (долгота ${mid.longitude.toFixed(1)})`)
  await g(() => window.__geovis.loadScenario('{"keyframes":[{"t":0,"camera":{"longitude":0,"latitude":99,"zoom":2,"pitch":0,"bearing":0}}]}'))
  await sleep(300)
  const err = await page.$eval('[data-testid=error]', (e) => e.textContent).catch(() => '')
  check(/не загружен.*диапазона/.test(err), `кривой сценарий отклонён: «${err}»`)
} catch (e) {
  check(false, `исключение: ${e.message}`)
}
const real = errors.filter((e) => !/Сценарий не загружен/.test(e))
check(real.length === 0, `JS-ошибок: ${real.length}${real.length ? '\n  ' + real.join('\n  ') : ''}`)
await browser.close()
console.log(failed ? `\nПРОВАЛ: ${failed}` : '\nВСЁ ОК')
process.exit(failed ? 1 : 0)
