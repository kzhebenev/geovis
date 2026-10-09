// Headless-проверка сцены в реальном Chrome (WebGL через SwiftShader).
//   node e2e/scene.e2e.mjs [URL] [папка-скриншотов]
// Проверяет ВИДИМЫЙ результат: столбики реально нарисованы (цветные пиксели),
// подписи на нужном языке, переключатели меняют картинку, 0 JS-ошибок.
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import { mkdirSync, writeFileSync } from 'node:fs'

const URL = process.argv[2] || 'http://localhost:4317/'
const OUT = process.argv[3] || 'e2e/shots'
mkdirSync(OUT, { recursive: true })

const errors = []
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed++ }

/** Доля «тёплых» пикселей (палитра inferno: красный/оранжевый/жёлтый) — это столбики. */
function warmShare(buf) {
  const png = PNG.sync.read(buf)
  let warm = 0
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]]
    if (r > 150 && r > b + 60 && g > 40) warm++
  }
  return warm / (png.width * png.height)
}

/** Доля отличающихся пикселей в прямоугольнике (область подписи). */
function diffIn(a, b, r) {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b)
  let d = 0, n = 0
  for (let y = Math.max(0, r.y | 0); y < Math.min(pa.height, (r.y + r.h) | 0); y++) {
    for (let x = Math.max(0, r.x | 0); x < Math.min(pa.width, (r.x + r.w) | 0); x++) {
      const i = (y * pa.width + x) * 4; n++
      if (Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]) > 60) d++
    }
  }
  return n ? d / n : 0
}

/** Почти белые пиксели — это текст подписей (палитры столбиков белого не дают, b ≤ 164). */
function whiteCount(buf) {
  const png = PNG.sync.read(buf)
  let n = 0
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] > 235 && png.data[i + 1] > 235 && png.data[i + 2] > 235) n++
  }
  return n
}

function diffShare(a, b) {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b)
  let d = 0
  for (let i = 0; i < pa.data.length; i += 4) {
    if (Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) +
        Math.abs(pa.data[i + 2] - pb.data[i + 2]) > 40) d++
  }
  return d / (pa.width * pa.height)
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 900 })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`))

const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => {
  const b = await page.screenshot({ type: 'png' })
  writeFileSync(`${OUT}/${name}.png`, b)
  return b
}

try {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForFunction(() => window.__geovis?.ready === true, { timeout: 60000 })
  await settle(2500)

  // 1. Глобус со столбиками
  const globe = await shot('01-globe')
  const w1 = warmShare(globe)
  check(w1 > 0.002, `глобус: столбики видны (тёплых пикселей ${(w1 * 100).toFixed(2)}%)`)

  // 2. HUD: настоящая цифра населения мира
  const total = await page.$eval('[data-testid=total]', (e) => e.textContent)
  check(/8,19 млрд/.test(total), `HUD: «${total}»`)

  // 3. Подписи RU → EN
  const ru = await page.evaluate(() => window.__geovis.visibleLabels())
  check(ru.includes('Токио') && ru.includes('Мумбаи'), `подписи RU: ${ru.join(', ')}`)
  check(!ru.includes('Нью-Йорк') && !ru.includes('Мехико'), 'обратная сторона глобуса: Нью-Йорка и Мехико нет')
  const box = await page.$eval('[data-label="Мумбаи"]', (e) => {
    const r = e.getBoundingClientRect(); return { v: e.dataset.visible, x: r.x, y: r.y, w: r.width, op: getComputedStyle(e).opacity }
  })
  check(box.v === '1' && box.w > 30 && box.x > 0 && box.x < 1600 && box.y > 0 && box.y < 900,
    `«Мумбаи» на экране: x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.w)}`)
  await page.click('[data-testid=lang-en]')
  await settle()
  const en = await page.evaluate(() => window.__geovis.visibleLabels())
  check(en.includes('Tokyo') && !en.includes('Токио'), `подписи EN: ${en.join(', ')}`)
  const totalEn = await page.$eval('[data-testid=total]', (e) => e.textContent)
  check(/8\.19 B/.test(totalEn), `HUD EN: «${totalEn}»`)
  await page.click('[data-testid=lang-ru]')

  // 4. Негатив: выключили города — подписей нет и картинка изменилась
  await page.click('[data-testid=toggle-cities]')
  await settle()
  const noLabels = await page.evaluate(() => window.__geovis.visibleLabels())
  check(noLabels.length === 0, `города выключены → подписей ${noLabels.length}`)
  const globeNoLabels = await shot('02-globe-no-labels')
  const wn = whiteCount(globeNoLabels)
  const dLabel = diffIn(globe, globeNoLabels, { x: box.x, y: box.y, w: box.w, h: 40 })
  check(dLabel > 0.2, `глобус: в области «Мумбаи» подпись реально нарисована (отличие ${(dLabel * 100).toFixed(0)}%)`)
  await page.click('[data-testid=toggle-cities]')

  // 5. Плоская карта с наклоном
  await page.click('[data-testid=proj-map]')
  await settle(2500)
  const map = await shot('03-map')
  const w2 = warmShare(map)
  check(w2 > 0.002, `карта: столбики видны (${(w2 * 100).toFixed(2)}%)`)
  check(whiteCount(map) - wn > 150, `карта: подписи нарисованы (белых ${whiteCount(map)} vs ${wn} без подписей)`)
  check(diffShare(globe, map) > 0.05, 'карта отличается от глобуса')

  // 6. Шкала: линейная даёт заметно меньше «высоких» столбиков, чем лог
  await page.click('[data-testid=scale-linear]')
  await settle()
  const lin = await shot('04-map-linear')
  const w3 = warmShare(lin)
  check(w3 < w2, `линейная шкала: тёплых меньше (${(w3 * 100).toFixed(2)}% < ${(w2 * 100).toFixed(2)}%)`)
  await page.click('[data-testid=scale-log]')

  // 7. Пролёт камерой: наклонённый глобус над Индией (сценарий для роликов)
  await page.click('[data-testid=proj-globe]')
  await page.evaluate(() => window.__geovis.setViewState({ longitude: 85, latitude: 18, zoom: 3.2, pitch: 55, bearing: -15 }))
  await page.evaluate(() => window.__geovis.setSettings({ showPanel: false }))
  await settle(2500)
  const fly = await shot('05-globe-pitch-india')
  check(warmShare(fly) > 0.005, `наклонная камера над Индией: столбики видны (${(warmShare(fly) * 100).toFixed(2)}%)`)
  check((await page.$('[data-testid=panel]')) === null, 'панель скрыта для чистого кадра')
  const flyLabels = await page.evaluate(() => window.__geovis.visibleLabels())
  check(flyLabels.includes('Мумбаи') && whiteCount(fly) > 150, `наклонный глобус: подписи ${flyLabels.join(', ')}`)

  // 8. Детализация 0.1° грузится
  await page.evaluate(() => window.__geovis.setSettings({ res: 0.1 }))
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.grid?.name.includes('g_0p1'), { timeout: 60000 })
  await settle(3000)
  await shot('06-globe-0p1')

  // 9. Каталог: набор 1975 года — другие цифры
  await page.evaluate(() => window.__geovis.setSettings({ showPanel: true }))
  await page.evaluate(() => window.__geovis.setFocus('world'))
  await settle()
  await page.click('[data-testid=open-data]')
  await page.waitForSelector('[data-testid=data-modal]')
  const groupsUi = await page.$$eval('[data-testid^=group-]', (els) => els.map((e) => e.textContent))
  check(groupsUi.length >= 6 && groupsUi.some((x) => x.includes('ВВП')), `группы наборов: ${groupsUi.join(', ')}`)
  const years = await page.$$eval('[data-testid^=dataset-pop]', (els) => els.map((e) => e.textContent))
  check(years.length === 16 && years[0] === '1975' && years[11] === '2030' && years[15] === '2100', `годы населения: ${years[0]}…${years[years.length - 1]} (${years.length})`)
  await page.click('[data-testid=dataset-pop1975]')   // выбор закрывает окно
  await page.waitForFunction(() => window.__geovis.grid?.name.includes('pop1975/'), { timeout: 60000 })
  await settle()
  const t75 = await page.$eval('[data-testid=total]', (e) => e.textContent)
  const title75 = await page.$eval('[data-testid=title]', (e) => e.textContent)
  check(/4,07 млрд/.test(t75) && title75.includes('1975'), `1975: «${title75}», «${t75}»`)
  await page.evaluate(() => window.__geovis.setDataset('pop2025'))

  // 10. Фокус «Россия»: светлый макет-поверхность со стенками
  await page.click('[data-testid=focus-select]'); await page.waitForSelector('[data-testid=focus-RUS]')
  await page.click('[data-testid=focus-RUS]')
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.mesh && window.__geovis.grid?.name.includes('pop2025/RUS_0p1'), { timeout: 120000 })
  await page.evaluate(() => window.__geovis.setSettings({ showPanel: false }))
  await settle(3500)
  const rus = await shot('07-rus-surface')
  const st = await page.evaluate(() => ({ s: window.__geovis.settings, m: window.__geovis.mesh, g: window.__geovis.grid }))
  check(st.s.mode === 'surface' && st.s.theme === 'light', `фокус RUS: вид ${st.s.mode}, тема ${st.s.theme}`)
  check(st.m.triangles > 100000 && st.m.walls > 1000, `меш: ${st.m.triangles} треугольников, ${st.m.walls} стенок`)
  const tR = await page.$eval('[data-testid=total]', (e) => e.textContent)
  check(/144,3 млн/.test(tR), `HUD России: «${tR}»`)
  const rl = await page.evaluate(() => window.__geovis.visibleLabels())
  check(rl.includes('Москва') && !rl.includes('Токио') && !rl.includes('Минск'), `подписи RU-фокуса: ${rl.join(', ')}`)
  const px = (buf, x, y) => { const g = PNG.sync.read(buf); const i = (y * g.width + x) * 4; return [g.data[i], g.data[i + 1], g.data[i + 2]] }
  const corner = px(rus, 1500, 850)
  check(corner.every((v) => v > 200), `светлый фон: угол кадра rgb(${corner})`)
  const teal = (buf) => { const g = PNG.sync.read(buf); let n = 0
    for (let i = 0; i < g.data.length; i += 4) if (g.data[i + 1] > 90 && g.data[i + 2] > 90 && g.data[i] < 120) n++
    return n / (g.width * g.height) }
  check(teal(rus) > 0.05, `поверхность России видна (бирюзовых пикселей ${(teal(rus) * 100).toFixed(1)}%)`)
  const red = (buf) => { const g = PNG.sync.read(buf); let n = 0
    for (let i = 0; i < g.data.length; i += 4) if (g.data[i] > 170 && g.data[i + 1] < 130 && g.data[i + 2] < 120) n++
    return n }
  check(red(rus) > 10, `красная вершина пика Москвы видна (${red(rus)} пикс.)`)

  // 11. Сглаживание и вид «столбики» меняют картинку
  await page.evaluate(() => window.__geovis.setSettings({ smooth: 0 }))
  await page.waitForFunction(() => window.__geovis?.ready, { timeout: 60000 })
  await settle(3000)
  const rough = await shot('08-rus-nosmooth')
  check(diffShare(rus, rough) > 0.01, `сглаживание меняет рельеф (${(diffShare(rus, rough) * 100).toFixed(1)}%)`)
  await page.evaluate(() => window.__geovis.setSettings({ mode: 'columns', smooth: 2 }))
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.mesh === null, { timeout: 60000 })
  await settle(3000)
  const rcol = await shot('09-rus-columns')
  check(teal(rcol) > 0.01 && diffShare(rus, rcol) > 0.01, 'столбики в фокусе России видны и отличаются от поверхности')

  // 12. Россия на глобусе
  await page.evaluate(() => window.__geovis.setSettings({ mode: 'surface', showPanel: true }))
  await settle(500)
  await page.click('[data-testid=proj-globe]')  // кнопка ставит и ракурс глобуса для региона
  await page.evaluate(() => window.__geovis.setSettings({ showPanel: false }))
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.mesh, { timeout: 60000 })
  await settle(3500)
  const rglobe = await shot('10-rus-globe')
  const gl = await page.evaluate(() => window.__geovis.visibleLabels())
  check(teal(rglobe) > 0.02 && gl.includes('Москва'), `Россия на глобусе: поверхность и подписи (${gl.slice(0, 4).join(', ')})`)

  // ошибки самого сайта — до намеренного 404 ниже
  check(errors.length === 0, `JS-ошибок: ${errors.length}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`)

  // 9. Негатив по данным: несуществующего уровня нет на сервере
  const bad = await page.evaluate(async () => {
    const r = await fetch('data/density_2025_9p9.json')
    return { status: r.status, json: (r.headers.get('content-type') || '').includes('json') }
  })
  check(!(bad.status === 200 && bad.json), `несуществующая сетка не отдаётся как данные (HTTP ${bad.status})`)
} catch (e) {
  check(false, `исключение: ${e.message}`)
}

await browser.close()
console.log(failed ? `\nПРОВАЛ: ${failed}` : '\nВСЁ ОК')
process.exit(failed ? 1 : 0)
