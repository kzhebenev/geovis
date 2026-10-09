// Сверка подписей со всеми наборами: node e2e/labels-audit.mjs [url]
// Для каждого набора и режима «Цифр»: заголовок, итог, легенда, каждая подпись → правила соответствия единицам.
import puppeteer from 'puppeteer-core'
const BASE = (process.argv[2] || 'http://localhost:8105').replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 850 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`${BASE}/?projection=map`, { waitUntil: 'networkidle0', timeout: 90000 })
await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })
const cat = await (await fetch(`${BASE}/data/catalog.json`)).json()
let failed = 0
const bad = (m) => { failed++; console.log('FAIL', m) }
const snap = () => page.evaluate(() => ({
  title: document.querySelector('[data-testid=title]')?.textContent ?? '',
  total: document.querySelector('[data-testid=total]')?.textContent ?? '',
  legend: document.querySelector('[data-testid=legend]')?.textContent ?? '',
  labels: [...document.querySelectorAll('[data-label]')].filter((e) => getComputedStyle(e).opacity !== '0')
    .map((e) => ({ name: e.getAttribute('data-label'), text: e.textContent })),
}))
const subOf = (l) => l.text.slice(l.name.length).trim()
const countrySet = new Set((await (await fetch(`${BASE}/data/countries.json`)).json()).map((c) => c.ru))
const popChina = {}

for (const d of cat.datasets) {
  const unit = d.unit.ru
  const people = /чел/.test(unit)
  for (const numbers of ['density', 'population']) {
    await page.evaluate((id, numbers) => {
      window.__geovis.setDataset(id)
      window.__geovis.setSettings({ numbers, showCities: true, showCountries: true, cityMinPop: 5e6, cityLimit: 25, compareWith: null, seriesYear: null })
      window.__geovis.setViewState({ longitude: 70, latitude: 30, zoom: 2.2, pitch: 0, bearing: 0 })
    }, d.id, numbers)
    await page.waitForFunction((id) => window.__geovis?.ready && window.__geovis.grid?.name.includes(`/${id}/`), { timeout: 90000 }, d.id)
    await sleep(1800)
    const s = await snap()
    const subs = s.labels.map((l) => [l.name, subOf(l)]).filter(([, x]) => x)
    if (numbers === 'density') {
      for (const [n, x] of subs) if (!x.endsWith(unit)) bad(`${d.id}: подпись «${n}: ${x}» не в единицах набора «${unit}»`)
      if (!subs.length) bad(`${d.id}: ни одной подписи с числом`)
      if (d.id === 'ships' && subs.some(([n]) => countrySet.has(n))) bad('ships: у стран не должно быть числа (набор про море)')
    } else {
      const ch = subs.find(([n]) => n === 'Китай'); if (ch) popChina[d.id] = ch[1]
      const far = d.year !== undefined && Math.abs(d.year - new Date().getFullYear()) > 5
      for (const [n, x] of subs.filter(([n]) => !countrySet.has(n)))
        if (far !== /сейчас/.test(x)) bad(`${d.id}: город «${n}: ${x}» — ${far ? 'нет пометки «сейчас»' : 'лишняя пометка «сейчас»'}`)
      for (const [n, x] of subs) if (/\/км|°C|мм|т CO|%|\$|м над/.test(x)) bad(`${d.id} (население): «${n}: ${x}» — не население`)
    }
    if (!people) for (const t of [s.title, s.total, s.legend, ...(numbers === 'density' ? subs.map((x) => x[1]) : [])])
      if (/чел/.test(t)) bad(`${d.id}: «чел» в наборе без людей: «${t}»`)
    if (numbers === 'density') console.log(`${d.id.padEnd(11)} | ${s.title} | ${s.total} | легенда: ${s.legend.slice(0, 40)} | ${subs.slice(0, 4).map(([n, x]) => `${n}: ${x}`).join('; ')}`)
  }
}
console.log('Китай, режим «Население»:', JSON.stringify(popChina))
if (popChina.pop1975 && popChina.pop1975 === popChina.pop2025) bad(`население Китая одинаково в 1975 и 2025: ${popChina.pop1975}`)
if (!popChina.pop1975) bad('нет подписи Китая в режиме «Население» на 1975')
for (const c of cat.country_datasets ?? []) {
  await page.evaluate((id) => window.__geovis.setCountryDataset(id), c.id)
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.countries, { timeout: 60000 }); await sleep(1500)
  const s = await snap(); const subs = s.labels.map((l) => [l.name, subOf(l)]).filter(([, x]) => x)
  for (const [n, x] of subs) if (!x.endsWith(c.unit.ru)) bad(`${c.id}: «${n}: ${x}» не в «${c.unit.ru}»`)
  if (!/чел/.test(c.unit.ru) && subs.some(([, x]) => /чел/.test(x))) bad(`${c.id}: «чел» в подписях`)
  console.log(`${c.id.padEnd(11)} | ${s.title} | ${s.total} | ${subs.slice(0, 4).map(([n, x]) => `${n}: ${x}`).join('; ')}`)
}
for (const r of cat.region_datasets ?? []) {
  await page.evaluate((id) => window.__geovis.setRegionDataset(id), r.id)
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.countries, { timeout: 60000 }); await sleep(1500)
  const s = await snap(); const subs = s.labels.map((l) => [l.name, subOf(l)]).filter(([, x]) => x)
  for (const [n, x] of subs) if (!x.endsWith(r.unit.ru)) bad(`${r.id}: «${n}: ${x}» не в «${r.unit.ru}»`)
  console.log(`${r.id.padEnd(11)} | ${s.title} | ${s.total} | ${subs.slice(0, 4).map(([n, x]) => `${n}: ${x}`).join('; ')}`)
}
if (errors.length) bad(`JS-ошибки: ${errors.join('; ')}`)
await browser.close()
console.log(failed ? `\nПРОВАЛ: ${failed}` : '\nВСЁ ОК')
