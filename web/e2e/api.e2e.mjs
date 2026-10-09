// Сквозная проверка «проект → API → визуализация в браузере».
//   GEOVIS_KEY=... node e2e/api.e2e.mjs [BASE_URL] [папка-скриншотов]
// Создаёт наборы через API, открывает выданные ссылки в headless Chrome и проверяет
// ВИДИМЫЙ результат (заголовок, подписи, пиксели), встраивание, встроенные наборы ВВП/климата; 0 JS-ошибок.
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = (process.argv[2] || 'http://localhost:4317').replace(/\/$/, '')
const OUT = process.argv[3] || 'e2e/shots-api'
const KEY = process.env.GEOVIS_KEY
if (!KEY) { console.error('нужен GEOVIS_KEY'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const local = (u) => u.replace(/^https?:\/\/[^/]+/, BASE)   // ссылки API → проверяемый адрес

async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/v1${path}`, {
    method, headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  })
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) }
}

const colorShare = (buf, pred) => {
  const p = PNG.sync.read(buf); let n = 0
  for (let i = 0; i < p.data.length; i += 4) if (pred(p.data[i], p.data[i + 1], p.data[i + 2])) n++
  return n / (p.width * p.height)
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const errors = []
async function open(url, name, waitFor = 'ready') {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 800 })
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !(name === '04-missing' && m.text().includes('404'))) errors.push(`${name}: ${m.text()}`) })
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
  if (waitFor === 'ready') await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })
  await new Promise((r) => setTimeout(r, 3000))
  const shot = await page.screenshot({ type: 'png' })
  writeFileSync(`${OUT}/${name}.png`, shot)
  return { page, shot }
}
const created = []

try {
  // 1. Точки: «магазины» с подписями → столбики + подписи с единицами
  const pts = await api('POST', '/datasets', {
    title: 'E2E: магазины сети', unit: '₽', kind: 'points', aggregation: 'sum', res: 0.25,
    points: [
      { lat: 55.75, lon: 37.62, value: 1200000, label: 'Тверская' },
      { lat: 59.93, lon: 30.33, value: 800000, label: 'Невский' },
      { lat: 56.84, lon: 60.6, value: 500000, label: 'Екб Центр' },
      ...Array.from({ length: 200 }, (_, i) => ({ lat: 50 + (i % 20) * 0.5, lon: 30 + Math.floor(i / 20) * 3, value: 1000 + i * 50 })),
    ],
    view: { mode: 'columns', theme: 'light', projection: 'map', palette: 'inferno', scale: 'sqrt',
      camera: { longitude: 45, latitude: 54, zoom: 3.6, pitch: 45, bearing: 0 } },
  })
  check(pts.status === 201 && pts.json.stats.points === 203, `API: точки приняты (${pts.status}, ${pts.json?.stats?.points})`)
  created.push(pts.json.id)
  {
    const { page, shot } = await open(local(pts.json.view_url), '01-points')
    const title = await page.$eval('[data-testid=title]', (e) => e.textContent)
    check(title === 'E2E: магазины сети', `заголовок своего набора: «${title}»`)
    const labels = await page.evaluate(() => window.__geovis.visibleLabels())
    check(labels.includes('Тверская') && labels.includes('Невский'), `подписи точек: ${labels.join(', ')}`)
    const sub = await page.$eval('[data-label="Тверская"]', (e) => e.textContent)
    check(/1,2\s?млн\s?₽/.test(sub), `значение и единицы в подписи: «${sub}»`)
    check(!labels.includes('Токио') && !labels.includes('Москва'), 'встроенные города не подмешиваются')
    const warm = colorShare(shot, (r, g, b) => r > 150 && r > b + 60)
    check(warm > 0.001, `столбики своих данных видны (${(warm * 100).toFixed(2)}%)`)
    const s = await page.evaluate(() => window.__geovis.settings)
    check(s.theme === 'light' && s.mode === 'columns' && s.projection === 'map', 'вид из набора применён')
    check(await page.$('[data-testid=custom-card]') !== null, 'карточка «Свой набор» в панели')
    await page.close()
  }

  // 2. Встраивание: без панели, со ссылкой GeoVis
  {
    const { page } = await open(local(pts.json.embed_url), '02-embed')
    check(await page.$('[data-testid=panel]') === null, 'embed: панели нет')
    check((await page.$$eval('a', (as) => as.map((a) => a.textContent))).some((t) => t.includes('GeoVis')), 'embed: ссылка на полную версию')
    await page.close()
  }

  // 3. Страны → 3D-картограмма + подписи стран со значениями
  const cty = await api('POST', '/datasets', {
    title: 'E2E: экспорт', unit: '$ млн', kind: 'countries',
    countries: [{ iso3: 'CHN', value: 120000 }, { iso3: 'DEU', value: 45000 }, { iso3: 'BRA', value: 30000 }, { iso3: 'RUS', value: 20000 }],
    view: { theme: 'dark', projection: 'globe', camera: { longitude: 60, latitude: 35, zoom: 1.5, pitch: 0, bearing: 0 } },
  })
  check(cty.status === 201, `API: страны приняты (${cty.status})`)
  created.push(cty.json.id)
  {
    const { page, shot } = await open(local(cty.json.view_url), '03-countries')
    const st = await page.evaluate(() => window.__geovis.countries)
    check(st && st.count === 4, `картограмма: стран ${st?.count}`)
    const labels = await page.evaluate(() => window.__geovis.visibleLabels())
    check(labels.includes('Китай') && labels.includes('Германия'), `подписи стран: ${labels.join(', ')}`)
    // цвет страны под подписью: у Китая (максимум) — верхний цвет палитры, у России — нет
    const TOP = { inferno: [252, 255, 164], viridis: [253, 231, 37], relief: [214, 74, 64], neon: [240, 249, 33], ice: [255, 255, 255] }
    const pal = (await page.evaluate(() => window.__geovis.settings.palette))
    const near = async (label) => {
      const r = await page.$eval(`[data-label="${label}"]`, (e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height } })
      const png = PNG.sync.read(shot); let best = 1e9
      for (let dy = 25; dy <= 60; dy += 5) for (let dx = -20; dx <= 20; dx += 10) {
        const i = ((Math.round(r.y + dy)) * png.width + Math.round(r.x + dx)) * 4
        best = Math.min(best, Math.hypot(png.data[i] - TOP[pal][0], png.data[i + 1] - TOP[pal][1], png.data[i + 2] - TOP[pal][2]))
      }
      return best
    }
    const dChina = await near('Китай'), dRussia = await near('Россия')
    check(dChina < 70 && dRussia > 70, `цвет максимума у Китая (Δ${dChina.toFixed(0)}), у России другой (Δ${dRussia.toFixed(0)})`)
    await page.close()
  }

  // 4. Негатив: несуществующий набор — понятная ошибка, а не пустой экран
  {
    const { page } = await open(`${BASE}/?ds=NoSuchSet123`, '04-missing', 'none')
    const err = await page.$eval('[data-testid=error]', (e) => e.textContent).catch(() => '')
    check(/не найден/.test(err), `несуществующий ds: «${err}»`)
    await page.close()
  }

  // 5. Встроенные: ВВП на сетке, ВВП стран (World Bank), температура (отрицательные значения)
  {
    const { page } = await open(`${BASE}/?dataset=gdp2024&projection=map&cam=10,48,3,40,0`, '05-gdp-grid')
    const g = await page.evaluate(() => window.__geovis.grid)
    check(g && g.name.includes('gdp2024') && g.total > 1.5e14 && g.total < 2.5e14, `ВВП на сетке: сумма $${(g?.total / 1e12).toFixed(1)} трлн`)
    const total = await page.$eval('[data-testid=total]', (e) => e.textContent)
    check(/трлн/.test(total), `HUD ВВП: «${total}»`)
    await page.close()
  }
  {
    const { page } = await open(`${BASE}/?countries=wb_gdp`, '06-wb-gdp')
    const st = await page.evaluate(() => window.__geovis.countries)
    check(st && st.count > 150 && st.max > 2e13, `ВВП стран WB: ${st?.count} стран, максимум $${(st?.max / 1e12).toFixed(1)} трлн`)
    const labels = await page.evaluate(() => window.__geovis.visibleLabels())
    check(labels.includes('Китай') || labels.includes('Индия'), `подписи лидеров ВВП: ${labels.slice(0, 6).join(', ')}`)
    // легенда: верхняя отметка = максимум набора, отметки растут, есть «нет данных», полоса в цветах палитры
    const lg = await page.$eval('[data-testid=legend]', (e) => ({
      unit: e.querySelector('[data-testid=legend-unit]').textContent,
      ticks: [...e.querySelectorAll('[data-testid=legend-tick]')].map((x) => x.textContent),
      text: e.textContent, bar: (() => { const b = e.querySelector('.h-2\\.5').getBoundingClientRect(); return { x: b.right - 3, y: b.y + b.height / 2 } })() }))
    const parse = (x) => { const m = x.replace(/[$\s]/g, '').replace(',', '.').match(/^(-?[\d.]+)(трлн|млрд|млн)?$/)
      return m ? Number(m[1]) * ({ 'трлн': 1e12, 'млрд': 1e9, 'млн': 1e6 }[m[2]] ?? 1) : NaN }
    const vals = lg.ticks.map(parse)
    check(lg.ticks.length === 5 && Math.abs(vals[4] - st.max) / st.max < 0.02,
      `легенда ВВП: ${lg.ticks.join(' · ')} (максимум данных $${(st.max / 1e12).toFixed(2)} трлн)`)
    check(vals.every((v, i) => i === 0 || v > vals[i - 1]), 'отметки легенды возрастают')
    const boxes = await page.$$eval('[data-testid=legend-tick]', (els) => els.map((e) => {
      const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return [b.left, b.right] }))
    const lb = await page.$eval('[data-testid=legend]', (e) => { const b = e.getBoundingClientRect(); return [b.left, b.right] })
    check(boxes.every((b, i) => i === 0 || b[0] >= boxes[i - 1][1] + 2) && boxes[0][0] >= lb[0] && boxes[4][1] <= lb[1],
      'подписи легенды не наезжают друг на друга и не выходят за рамку')
    check(lg.unit.includes('$') && /нет данных/.test(lg.text), `единицы «${lg.unit}» и «нет данных» в легенде`)
    const shotL = await page.screenshot({ type: 'png' })
    const png = PNG.sync.read(shotL); const i = (Math.round(lg.bar.y) * png.width + Math.round(lg.bar.x)) * 4
    const TOPC = { inferno: [252, 255, 164], viridis: [253, 231, 37], relief: [214, 74, 64], neon: [240, 249, 33], ice: [255, 255, 255] }
    const pal = await page.evaluate(() => window.__geovis.settings.palette)
    const dc = Math.hypot(png.data[i] - TOPC[pal][0], png.data[i + 1] - TOPC[pal][1], png.data[i + 2] - TOPC[pal][2])
    check(dc < 40, `правый край легенды — верхний цвет палитры ${pal} (Δ${dc.toFixed(0)})`)
    await page.close()
  }
  {
    const { page } = await open(`${BASE}/?dataset=temp&mode=surface`, '07-temp')
    const g = await page.evaluate(() => window.__geovis.grid)
    check(g && g.min < -20 && g.max > 25, `температура: от ${g?.min.toFixed(1)} до ${g?.max.toFixed(1)} °C`)
    const tk = await page.$$eval('[data-testid=legend-tick]', (els) => els.map((e) => e.textContent))
    check(/^[-−]\d/.test(tk[0]) && !/^[-−]/.test(tk[4]), `легенда температуры от минуса до плюса: ${tk.join(' · ')}`)
    const tv = tk.map((x) => Number(x.replace('−', '-').replace(',', '.')))
    const steps = tv.slice(1).map((v, i) => v - tv[i])
    check(Math.max(...steps) - Math.min(...steps) < 0.2, `шкала температуры по ссылке — линейная из каталога (шаги ${steps.map((x) => x.toFixed(1)).join(', ')})`)
    await page.close()
  }
  {
    const { page } = await open(`${BASE}/?countries=wb_gdp&legend=0`, '08-no-legend')
    check(await page.$('[data-testid=legend]') === null, 'legend=0 — легенды нет (для чистого кадра)')
  }
  // 6. Фокусы ЕАЭС по ссылке: светлая поверхность страны, только её города
  {
    const { page } = await open(`${BASE}/?dataset=pop2025&focus=KAZ`, '09-focus-kaz')
    const st = await page.evaluate(() => ({ s: window.__geovis.settings, g: window.__geovis.grid, m: window.__geovis.mesh }))
    check(st.s.focus === 'KAZ' && st.s.mode === 'surface' && st.s.theme === 'light' && st.s.palette === 'relief' && st.g.name.includes('KAZ_'),
      `focus=KAZ по ссылке: ${st.s.mode}, ${st.s.theme}, ${st.s.palette}, ${st.g.name.split('/').pop()}`)
    check(st.g.total > 18e6 && st.g.total < 22e6, `население Казахстана в данных: ${(st.g.total / 1e6).toFixed(1)} млн`)
    const lb = await page.evaluate(() => window.__geovis.visibleLabels())
    check(lb.includes('Алматы') && lb.includes('Астана') && !lb.includes('Москва') && !lb.includes('Ташкент'), `подписи только городов Казахстана: ${lb.slice(0, 5).join(', ')}`)
    await page.close()
  }

  // 7. Временной ряд по странам: ползунок лет, разные значения, общая шкала
  const ser = await api('POST', '/datasets', {
    title: 'E2E: ВВП ЕАЭС', unit: '$', kind: 'countries', ttl_days: 1,
    countries: [{ iso3: 'RUS', year: 2015, value: 1.36e12 }, { iso3: 'RUS', year: 2024, value: 2.19e12 },
      { iso3: 'KAZ', year: 2015, value: 1.84e11 }, { iso3: 'KAZ', year: 2024, value: 2.88e11 }],
    view: { projection: 'map', camera: { longitude: 70, latitude: 52, zoom: 2.4, pitch: 30, bearing: 0 } },
  })
  check(ser.status === 201 && ser.json.stats.years?.join('–') === '2015–2024' && ser.json.expires, `ряд принят: ${ser.json?.stats?.years}, ttl до ${new Date(ser.json?.expires * 1000).toISOString().slice(0, 10)}`)
  created.push(ser.json.id)
  {
    const { page } = await open(local(ser.json.view_url), '10-series-2024')
    const c24 = await page.evaluate(() => window.__geovis.countries)
    const t24 = await page.$eval('[data-testid=title]', (e) => e.textContent)
    check(c24.year === 2024 && c24.years.join() === '2015,2024' && /2024/.test(t24), `ряд: по умолчанию последний год (${t24})`)
    const v24 = await page.$eval('[data-label="Россия"]', (e) => e.textContent)
    await page.evaluate(() => window.__geovis.setSettings({ year: 2015 }))
    await sleep(1500)
    const v15 = await page.$eval('[data-label="Россия"]', (e) => e.textContent)
    check(/2,19\s?трлн/.test(v24) && /1,36\s?трлн/.test(v15), `значения России по годам: «${v24}» → «${v15}»`)
    const ticks = await page.$$eval('[data-testid=legend-tick]', (els) => els.map((e) => e.textContent))
    check(/2,2 трлн/.test(ticks[4]), `шкала общая на все годы (максимум легенды ${ticks[4]} и в 2015)`)
    await page.close()
  }
  {
    // ползунок лет в панели (не embed): двигаем — меняется год
    const { page } = await open(`${BASE}/?countries=wb_gdp`, '10b-wb-years')
    const yrs = await page.evaluate(() => window.__geovis.countries.years)
    check(yrs[0] <= 2000 && yrs[yrs.length - 1] >= 2024, `ВВП World Bank — ряд ${yrs[0]}–${yrs[yrs.length - 1]}`)
    await page.$eval('[data-testid=year-range]', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, '15'); el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(1500)
    const y = await page.evaluate(() => window.__geovis.countries.year)
    check(y === yrs[15], `ползунок лет переключает год: ${y}`)
    await page.close()
  }

  // 8. PNG-снимки: настоящая картинка нужного размера, свой набор и встроенный
  for (const [name, url] of [['own', `${BASE}/api/v1/datasets/${ser.json.id}/snapshot.png?w=800&h=450&year=2015`],
    ['builtin', `${BASE}/api/v1/snapshot.png?dataset=pop2025&focus=ARM&w=640&h=360`]]) {
    const t0 = Date.now()
    const r = await fetch(url)
    const buf = Buffer.from(await r.arrayBuffer())
    const ok = r.status === 200 && r.headers.get('content-type') === 'image/png'
    const png = ok ? PNG.sync.read(buf) : null
    const colors = png ? new Set(Array.from({ length: 2000 }, (_, i) => png.data.readUInt32BE(Math.floor(i * png.data.length / 2000 / 4) * 4))).size : 0
    check(ok && png.width === (name === 'own' ? 800 : 640) && colors > 50,
      `снимок ${name}: HTTP ${r.status}, ${png?.width}×${png?.height}, ${buf.length} байт, ${colors} цветов, ${Date.now() - t0} мс`)
    if (png) writeFileSync(`${OUT}/11-snapshot-${name}.png`, buf)
  }
  // 9. Регионы: ВРП Росстата по субъектам РФ, свой набор по регионам, снимок
  {
    const { page, shot } = await open(`${BASE}/?regions=rosstat_vrp`, '12-rosstat-vrp')
    const st = await page.evaluate(() => window.__geovis.countries)
    check(st && st.count === 85 && st.year >= 2023 && st.years[0] === 1998, `ВРП Росстата: ${st?.count} регионов, ${st?.years?.[0]}–${st?.year}`)
    const lb = await page.evaluate(() => window.__geovis.visibleLabels())
    check(lb.includes('Москва') && !lb.includes('Россия'), `подписи регионов-лидеров: ${lb.slice(0, 5).join(', ')}`)
    const title = await page.$eval('[data-testid=title]', (e) => e.textContent)
    check(/ВРП регионов России.*20\d\d/.test(title), `заголовок: «${title}»`)
    const teal = colorShare(shot, (r, g, b) => g > 100 && b > 80 && r < 120)
    check(teal > 0.01, `картограмма регионов видна (${(teal * 100).toFixed(1)}%)`)
    await page.close()
  }
  const reg = await api('POST', '/datasets', { title: 'E2E: продажи по регионам', unit: '₽ млн', kind: 'regions', ttl_days: 1,
    regions: [{ code: 'RU-MOW', value: 1200 }, { code: 'RU-SPE', value: 640 }, { code: 'RU-SVE', value: 300 }, { code: 'KZ-ALA', value: 210 }],
    view: { projection: 'map', camera: { longitude: 55, latitude: 52, zoom: 3, pitch: 30, bearing: 0 } } })
  check(reg.status === 201 && reg.json.stats.regions === 4, `свой набор по регионам принят (${reg.status})`)
  created.push(reg.json.id)
  {
    const { page } = await open(local(reg.json.view_url), '13-own-regions')
    const st = await page.evaluate(() => window.__geovis.countries)
    const lb = await page.evaluate(() => window.__geovis.visibleLabels())
    check(st?.count === 4 && lb.includes('Москва'), `свои регионы на карте: ${st?.count}, подписи ${lb.join(', ')}`)
    await page.close()
  }
  const badReg = await api('POST', '/datasets', { title: 'x', kind: 'regions', regions: [{ code: 'RU-ZZZ', value: 1 }] })
  check(badReg.status === 422, `неизвестный код региона → ${badReg.status}`)
  {
    const r = await fetch(`${BASE}/api/v1/snapshot.png?regions=rosstat_vrp_pc&year=2010&w=640&h=360`)
    check(r.status === 200 && r.headers.get('content-type') === 'image/png', `снимок ВРП на душу 2010: ${r.status}`)
  }
  // 10. Превью ссылок (og:image) и вертикальное видео
  {
    const html = await (await fetch(`${BASE}/?dataset=gdp2024&focus=RUS&embed=1`)).text()
    const og = (html.match(/property="og:image" content="([^"]+)"/) || [])[1] || ''
    check(og.includes('/api/v1/preview.png?dataset=gdp2024&focus=RUS&embed=1'), `og:image в HTML: ${og}`)
    const evil = await (await fetch(`${BASE}/?x=%22%3E%3Cscript%3Ealert(1)%3C/script%3E`)).text()
    check(!/<script>alert/.test(evil), 'вредная строка запроса в HTML не попадает')
    const pr = await fetch(`${BASE}/api/v1/preview.png?ds=${reg.json.id}&embed=1&scenario=x`)
    const buf = Buffer.from(await pr.arrayBuffer())
    const png = pr.status === 200 ? PNG.sync.read(buf) : null
    check(png && png.width === 1200 && png.height === 630, `превью ${pr.status}: ${png?.width}×${png?.height}`)
    const vv = await fetch(`${BASE}/api/v1/videos`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: { keyframes: [{ t: 0, camera: { longitude: 0, latitude: 0, zoom: 2 } }] }, fps: 24, quality: '4k_v' }) })
    check(vv.status === 422, `видео: неизвестное качество → ${vv.status}`)
  }
  const bad = await fetch(`${BASE}/api/v1/snapshot.png?dataset=pop2025&hack=1`)
  check(bad.status === 422, `снимок с неизвестным параметром → ${bad.status}`)
} catch (e) {
  check(false, `исключение: ${e.message}`)
}

for (const id of created) await api('DELETE', `/datasets/${id}`)
const after = await api('GET', `/datasets/${created[0]}`)
check(after.status === 404, `тестовые наборы удалены (${after.status})`)
check(errors.length === 0, `JS-ошибок: ${errors.length}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`)
await browser.close()
console.log(failed ? `\nПРОВАЛ: ${failed}` : '\nВСЁ ОК')
process.exit(failed ? 1 : 0)
