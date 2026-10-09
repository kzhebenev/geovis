// Интерфейс: сворачиваемые блоки, окно выбора данных, справка по сценариям, выгрузка MP4.
//   node e2e/ui.e2e.mjs [BASE_URL] [папка]   (видео — настоящий рендер на сервере, ~1–3 мин)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const BASE = (process.argv[2] || 'http://localhost:4317').replace(/\/$/, '')
const OUT = process.argv[3] || 'e2e/shots-ui'
mkdirSync(OUT, { recursive: true })
let failed = 0
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// поле поиска: поставить значение целиком (как пользователь, который стёр и набрал заново)
const setSearch = (page, v) => page.$eval('[data-testid=data-search]', (el, val) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, v)

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 850 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })

  // 1. Сворачиваемые блоки: свернуть «Отображение» — кнопки скрыты; после перезагрузки остаётся свёрнутым
  check(await page.$('[data-testid=scale-log]') !== null, 'блок «Отображение» открыт по умолчанию')
  await page.click('[data-testid=block-toggle-display]')
  check(await page.$('[data-testid=scale-log]') === null, 'свернули «Отображение» — кнопки шкалы скрыты')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })
  check(await page.$('[data-testid=scale-log]') === null, 'после перезагрузки блок по-прежнему свёрнут')
  await page.click('[data-testid=block-toggle-display]')
  check(await page.$('[data-testid=scale-log]') !== null, 'развернули обратно')
  await page.click('[data-testid=block-toggle-scenario]')
  check(await page.$('[data-testid=play]') === null, 'блок «Сценарий полёта» сворачивается')
  await page.click('[data-testid=block-toggle-scenario]')

  // 1б. Панель: стилизованные списки (мышь и клавиатура), тема панели, скрытие/показ
  await page.click('[data-testid=compare-select]')
  await page.waitForSelector('[data-testid=compare-select-list]')
  const opts = await page.$$eval('[data-testid=compare-select-list] [role=option]', (els) => els.map((e) => e.textContent))
  check(opts[0] === 'Нет' && opts.includes('1975') && opts.includes('2100'), `список «Сравнить с»: ${opts.length} пунктов (${opts[0]}…${opts[opts.length - 1]})`)
  await page.click('[data-testid=compare-pop1975]')
  await page.waitForFunction(() => window.__geovis.settings.compareWith === 'pop1975', { timeout: 5000 })
  const cv = await page.$eval('[data-testid=compare-select]', (e) => e.textContent)
  check(cv.includes('1975') && await page.$('[data-testid=compare-select-list]') === null, `выбор мышью: «${cv}», список закрылся`)
  await page.focus('[data-testid=compare-select]')
  await page.keyboard.press('ArrowDown'); await page.waitForSelector('[data-testid=compare-select-list]')
  await page.keyboard.press('Home'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__geovis.settings.compareWith === null, { timeout: 5000 })
  check(true, 'клавиатура: ↓ открыть, Home, Enter — «Нет»')
  await page.click('[data-testid=focus-select]'); await page.waitForSelector('[data-testid=focus-select-list]')
  await page.keyboard.press('Escape')
  check(await page.$('[data-testid=focus-select-list]') === null && (await page.evaluate(() => window.__geovis.settings.focus)) === 'world',
    'Esc закрывает список без выбора')
  await page.evaluate(() => window.__geovis.setSettings({ theme: 'light' })); await sleep(300)
  const pbg = await page.$eval('[data-testid=panel]', (e) => [e.dataset.theme, getComputedStyle(e).backgroundColor])
  check(pbg[0] === 'light' && /255, 255, 255/.test(pbg[1]), `светлая тема — светлая панель (${pbg[1]})`)
  await page.evaluate(() => window.__geovis.setSettings({ theme: 'dark' }))
  await page.click('[data-testid=hide-panel]'); await sleep(200)
  check(await page.$('[data-testid=panel]') === null && await page.$('[data-testid=show-panel]') !== null, 'панель скрывается, остаётся кнопка «Настройки»')
  await page.click('[data-testid=show-panel]'); await page.waitForSelector('[data-testid=panel]')
  writeFileSync(`${OUT}/00-panel.png`, await page.screenshot())

  // 2. Окно выбора данных: поиск, выбор, Esc
  await page.click('[data-testid=open-data]')
  await page.waitForSelector('[data-testid=data-modal]')
  writeFileSync(`${OUT}/01-data-modal.png`, await page.screenshot())
  const box = await page.$eval('[data-testid=data-modal] [role=dialog]', (e) => { const b = e.getBoundingClientRect(); return { x: b.x, w: b.width } })
  check(box.w > 600 && Math.abs(box.x + box.w / 2 - 700) < 40, `окно данных по центру экрана, а не внутри панели (x=${Math.round(box.x)}, w=${Math.round(box.w)})`)
  const all = await page.$$eval('[data-testid^=group-]', (e) => e.length)
  await setSearch(page, 'ВВП')
  const gdpOnly = await page.$$eval('[data-testid^=group-]', (e) => e.map((x) => x.dataset.testid))
  check(all >= 6 && gdpOnly.length === 1 && gdpOnly[0] === 'group-gdp', `поиск «ВВП»: групп ${all} → ${gdpOnly.join(',')}`)
  await setSearch(page, 'абракадабра')
  check(await page.$('[data-testid=data-empty]') !== null, 'нет совпадений — «Ничего не найдено»')
  await setSearch(page, 'климат')
  const climate = await page.$$eval('[data-testid^=group-]', (e) => e.map((x) => x.dataset.testid))
  check(climate.join() === 'group-climate', `поиск «климат»: ${climate.join()}`)
  await page.click('[data-testid=dataset-temp]')
  await page.waitForFunction(() => window.__geovis.grid?.name.includes('/temp/'), { timeout: 60000 })
  check(await page.$('[data-testid=data-modal]') === null, 'выбор набора закрывает окно')
  const act = await page.$eval('[data-testid=active-dataset]', (e) => e.textContent)
  check(/Температура/.test(act), `в панели — текущий набор: «${act}»`)
  await page.click('[data-testid=open-data]'); await page.keyboard.press('Escape')
  check(await page.$('[data-testid=data-modal]') === null, 'Esc закрывает окно данных')

  // 2б. «Цифры» зависят от набора: осадки — в мм/год, «Население города» — население; у стран раздела нет
  await page.evaluate(() => { window.__geovis.setDataset('precip'); window.__geovis.setSettings({ numbers: 'density', showCities: true }) })
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.grid?.name.includes('/precip/'), { timeout: 60000 })
  await sleep(1500)
  const chips = await page.$$eval('[data-testid^=numbers-]', (els) => els.map((e) => e.textContent))
  check(chips.join('|') === 'Нет|Осадки, мм/год|Население города', `кнопки «Цифры» для осадков: ${chips.join(', ')}`)
  const tokyoP = await page.$eval('[data-label="Токио"]', (e) => e.textContent)
  check(/мм\/год/.test(tokyoP) && !/чел/.test(tokyoP), `подпись в мм/год: «${tokyoP}»`)
  await page.click('[data-testid=numbers-population]'); await sleep(800)
  const tokyoPop = await page.$eval('[data-label="Токио"]', (e) => e.textContent)
  check(/млн/.test(tokyoPop) && !/мм/.test(tokyoPop), `«Население города»: «${tokyoPop}»`)
  await page.evaluate(() => window.__geovis.setDataset('temp'))
  await page.waitForFunction(() => window.__geovis.grid?.name.includes('/temp/'), { timeout: 60000 }); await sleep(800)
  const tchip = await page.$eval('[data-testid=numbers-density]', (e) => e.textContent)
  check(tchip === 'Температура, °C', `кнопка значения для температуры: «${tchip}»`)
  await page.evaluate(() => window.__geovis.setCountryDataset('wb_gdp'))
  await page.waitForFunction(() => window.__geovis?.countries, { timeout: 60000 }); await sleep(800)
  check(await page.$('[data-testid=numbers-density]') === null, 'на карте по странам раздела «Цифры» нет (значение всегда в подписи)')
  await page.evaluate(() => { window.__geovis.setDataset('pop2025'); window.__geovis.setSettings({ numbers: 'density' }) })
  await page.waitForFunction(() => window.__geovis.grid?.name.includes('/pop2025/'), { timeout: 60000 }); await sleep(800)
  const pchip = await page.$eval('[data-testid=numbers-density]', (e) => e.textContent)
  check(pchip === 'Плотность, чел/км²', `для населения: «${pchip}»`)

  // 2б. Подписи стран — значение ТЕКУЩЕГО набора по стране (баг: на карте CO₂ у Индонезии было «144 чел/км²»)
  await page.evaluate(() => { window.__geovis.setDataset('co2_2025'); window.__geovis.setSettings({ numbers: 'density', showCountries: true, projection: 'map' })
    window.__geovis.setViewState({ longitude: 115, latitude: -2, zoom: 3.2, pitch: 0, bearing: 0 }) })
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.grid?.name.includes('/co2_2025/'), { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('[data-label="Индонезия"]')?.textContent.includes('CO'), { timeout: 20000 }).catch(() => {})
  const idn = await page.$eval('[data-label="Индонезия"]', (e) => e.textContent).catch(() => '')
  const truth = (await (await fetch(`${BASE}/data/co2_2025/countries.json`)).json()).values.IDN[0]
  const shown = Number((idn.match(/[\d\s ]+(?=\s*т)/)?.[0] ?? '').replace(/\s| /g, ''))
  check(/т CO₂/.test(idn) && !/чел/.test(idn) && Math.abs(shown - truth) <= 1,
    `Индонезия на карте CO₂: «${idn}» (среднее по стране ${truth.toFixed(1)})`)
  await page.evaluate(() => window.__geovis.setDataset('temp'))
  await page.waitForFunction(() => window.__geovis.grid?.name.includes('/temp/'), { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('[data-label="Индонезия"]')?.textContent.includes('°C'), { timeout: 20000 }).catch(() => {})
  const idnT = await page.$eval('[data-label="Индонезия"]', (e) => e.textContent).catch(() => '')
  check(/2[0-9](,\d)? °C/.test(idnT) && !/чел/.test(idnT), `Индонезия на карте температур: «${idnT}»`)
  await page.evaluate(() => window.__geovis.setSettings({ projection: 'globe' }))

  // 2в. Разница и плавный год
  await page.evaluate(() => { window.__geovis.setDataset('pop2025'); window.__geovis.setSettings({ compareWith: 'pop1975', numbers: 'density', showCities: true }) })
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.grid?.diff, { timeout: 90000 }); await sleep(1500)
  const dt = await page.$eval('[data-testid=title]', (e) => e.textContent)
  check(/Население: 2025 − 1975/.test(dt), `разница: заголовок «${dt}»`)
  const dsub = await page.$eval('[data-label="Дели"]', (e) => e.textContent).catch(() => '')
  check(/\+[\d\s,]+ чел\/км²/.test(dsub), `рост со знаком в подписи: «${dsub}»`)
  const dtick = await page.$$eval('[data-testid=legend-tick]', (els) => els.map((e) => e.textContent))
  check(/^[-−]/.test(dtick[0]) && /^0$/.test(dtick[2]), `легенда разницы симметрична: ${dtick.join(' · ')}`)
  writeFileSync(`${OUT}/04-diff.png`, await page.screenshot())
  await page.evaluate(() => window.__geovis.setSettings({ compareWith: null, seriesYear: 2000 }))
  await page.waitForFunction(() => window.__geovis?.ready && !window.__geovis.grid?.diff && window.__geovis.grid?.year === 2000, { timeout: 90000 })
  const st = await page.$eval('[data-testid=title]', (e) => e.textContent)
  const g = await page.evaluate(() => window.__geovis.grid)
  check(/Население 2000/.test(st) && g.total > 6.0e9 && g.total < 6.3e9, `плавный год 2000: «${st}», население ${(g.total / 1e9).toFixed(2)} млрд`)
  await page.evaluate(() => window.__geovis.setSettings({ seriesYear: 2002.5 }))
  await page.waitForFunction(() => window.__geovis.grid?.name.includes('@0.5000'), { timeout: 90000 })
  const g2 = await page.evaluate(() => window.__geovis.grid)
  check(g2.total > g.total, `между эпохами — смесь (2002,5: ${(g2.total / 1e9).toFixed(3)} млрд > ${(g.total / 1e9).toFixed(3)})`)
  await page.evaluate(() => window.__geovis.setSettings({ seriesYear: null }))

  // 2г. Свои данные из таблицы (CSV): страны по-русски → картограмма; неизвестное — в списке
  await page.click('[data-testid=open-upload]')
  await page.waitForSelector('[data-testid=csv-modal]')
  await page.$eval('[data-testid=csv-text]', (el) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Страна;Год;ВВП\nРоссия;2015;1,36\nРоссия;2024;2,19\nКазахстан;2024;0,29\nАтлантида;2024;9')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  const sum = await page.$eval('[data-testid=csv-summary]', (e) => e.textContent)
  check(/страны.*3.*2015–2024/.test(sum) && /Атлантида/.test(sum), `разбор таблицы: «${sum.slice(0, 120)}»`)
  await page.click('[data-testid=csv-show]')
  await page.waitForFunction(() => window.__geovis?.ready && window.__geovis.countries?.count === 2, { timeout: 60000 })
  // подписи ставятся после перелёта камеры к данным — без видеокарты это несколько секунд
  await page.waitForFunction(() => window.__geovis.visibleLabels().includes('Россия'), { timeout: 20000 }).catch(() => {})
  const cl = await page.evaluate(() => window.__geovis.visibleLabels())
  check(cl.includes('Россия') && cl.includes('Казахстан'), `своя таблица на карте: ${cl.join(', ')}`)
  writeFileSync(`${OUT}/05-csv.png`, await page.screenshot())
  await page.evaluate(() => window.__geovis.setDataset('pop2025'))

  // 3. Справка по сценариям: шаблон открывается в редакторе
  await page.click('[data-testid=help]')
  await page.waitForSelector('[data-testid=scenario-help]')
  writeFileSync(`${OUT}/02-help.png`, await page.screenshot())
  const hb = await page.$eval('[data-testid=scenario-help] [role=dialog]', (e) => e.getBoundingClientRect().width)
  check(hb > 600, `справка — широкое окно (${Math.round(hb)} px)`)
  const tpl = await page.$eval('[data-testid=scenario-template]', (e) => JSON.parse(e.textContent))
  check(tpl.keyframes.length === 4, `в справке шаблон из ${tpl.keyframes.length} кадров`)
  await page.click('[data-testid=use-template]')
  const sc = await page.evaluate(() => window.__geovis.scenario)
  check(sc.id === 'custom' && sc.duration === 13, `шаблон загружен в редактор: ${sc.duration} с`)

  // 4. Видео: короткий сценарий → MP4 на сервере → скачивание → ffprobe
  await page.evaluate(() => window.__geovis.loadScenario({ title: { ru: 'e2e видео', en: 'e2e' }, keyframes: [
    { t: 0, camera: { longitude: 30, latitude: 50, zoom: 2.5, pitch: 30, bearing: 0 },
      settings: { dataset: 'pop2025', focus: 'world', mode: 'columns', projection: 'map', theme: 'dark', res: 1 } },
    { t: 2, camera: { longitude: 40, latitude: 52, zoom: 3, pitch: 45, bearing: 20 }, caption: { ru: 'Тест' } }] }))
  await page.click('[data-testid=video]')
  await page.waitForSelector('[data-testid=video-modal]')
  await page.click('[data-testid=q-720p]'); await page.click('[data-testid=fps-24]')
  const t0 = Date.now()
  await page.click('[data-testid=video-start]')
  // долгий рендер: опрос раз в 5 с (waitForSelector дольше нескольких минут обрывает таймаут протокола)
  for (let i = 0; i < 240 && !(await page.$('[data-testid=video-download], [data-testid=video-error]')); i++) await sleep(5000)
  writeFileSync(`${OUT}/03-video-done.png`, await page.screenshot())
  const href = await page.$eval('[data-testid=video-download]', (a) => a.getAttribute('href')).catch(() => null)
  check(Boolean(href), `видео отрендерено за ${((Date.now() - t0) / 1000).toFixed(0)} с`)
  if (href) {
    const buf = Buffer.from(await (await fetch(`${BASE}${href}`)).arrayBuffer())
    writeFileSync(`${OUT}/video.mp4`, buf)
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=width,height,codec_name,nb_frames,avg_frame_rate:format=duration', '-of', 'json', `${OUT}/video.mp4`]).toString())
    const st = info.streams[0], dur = Number(info.format.duration)
    check(st.codec_name === 'h264' && st.width === 1280 && st.height === 720 && Math.abs(dur - 2.04) < 0.15 && Number(st.nb_frames) === 49,
      `MP4: ${st.codec_name} ${st.width}×${st.height}, ${st.nb_frames} кадров, ${dur.toFixed(2)} с, ${(buf.length / 1e3).toFixed(0)} КБ`)
    // первый и последний кадры разные (камера летела)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUT}/video.mp4`, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', `${OUT}/v-first.png`])
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.1', '-i', `${OUT}/video.mp4`, '-frames:v', '1', `${OUT}/v-last.png`])
    const a = PNG.sync.read(readFileSync(`${OUT}/v-first.png`)), b = PNG.sync.read(readFileSync(`${OUT}/v-last.png`))
    let d = 0
    for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 40) d++
    const share = d / (a.width * a.height)
    check(share > 0.05, `первый и последний кадры ролика разные — камера летела (${(share * 100).toFixed(0)}% пикселей)`)
  }
  const bad = await fetch(`${BASE}/api/v1/videos`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: { keyframes: [] }, fps: 24 }) })
  check(bad.status === 422, `пустой сценарий на видео → ${bad.status}`)

  // телефон: панель свёрнута, открывается шторкой снизу во всю ширину
  const m = await browser.newPage()
  m.on('pageerror', (e) => errors.push(String(e)))
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await m.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 60000 })
  await m.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })
  check(await m.$('[data-testid=panel]') === null && await m.$('[data-testid=show-panel]') !== null, 'телефон: панель свёрнута, видна кнопка «Настройки»')
  await m.click('[data-testid=show-panel]'); await m.waitForSelector('[data-testid=panel]')
  const sheet = await m.$eval('[data-testid=panel]', (e) => { const b = e.getBoundingClientRect(); return { x: b.x, w: b.width, bottom: innerHeight - b.bottom, h: b.height } })
  check(sheet.w > 360 && sheet.bottom < 20 && sheet.h < 844 * 0.62, `телефон: шторка снизу ${Math.round(sheet.w)}×${Math.round(sheet.h)}`)
  writeFileSync(`${OUT}/06-mobile-sheet.png`, await m.screenshot())
  await m.close()
} catch (e) {
  check(false, `исключение: ${e.message}`)
}
check(errors.length === 0, `JS-ошибок: ${errors.length}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`)
await browser.close()
console.log(failed ? `\nПРОВАЛ: ${failed}` : '\nВСЁ ОК')
process.exit(failed ? 1 : 0)
