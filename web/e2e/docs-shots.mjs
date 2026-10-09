// Скриншоты для документации (docs/screenshots): node web/e2e/docs-shots.mjs [url] [ru|en]
// Только наборы со свободной лицензией (CC BY / public domain) — см. DATA_SOURCES.md.
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const BASE = (process.argv[2] || 'http://localhost:8105').replace(/\/$/, '')
const LANG = process.argv[3] || 'ru'   // ru | en — язык интерфейса на скриншотах
const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
async function shot(name, query, { w = 1600, h = 900, panel = false, after, settle = 4000, mobile = false } = {}) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`))
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: w, height: h })
  await page.goto(`${BASE}/?${query}&lang=${LANG}`, { waitUntil: 'networkidle0', timeout: 120000 })
  await page.waitForFunction(() => window.__geovis?.ready, { timeout: 120000 })
  if (!panel && !mobile) await page.evaluate(() => window.__geovis.setSettings({ showPanel: false }))
  if (after) await after(page)
  await sleep(settle)
  await page.screenshot({ path: `${OUT}${name}${LANG === 'ru' ? '' : '-' + LANG}.png` })
  await page.close()
  console.log('ok', name)
}
await shot('hero-globe', 'dataset=pop2025&projection=globe&theme=dark&mode=columns&cam=75,28,1.9,25,0', { panel: true })
await shot('russia-surface', 'dataset=pop2025&focus=RUS')
await shot('regions-grp', 'regions=rosstat_vrp')
await shot('diff-1975-2025', 'dataset=pop2025&compare=pop1975&projection=map&theme=dark&cam=80,25,2.6,45,0')
await shot('countries-gdp', 'countries=wb_gdp&projection=map&theme=dark&cam=20,35,1.6,45,0')
await shot('night-lights', 'dataset=lights2016&projection=map&theme=dark&mode=surface&cam=10,48,3.2,50,0')
await shot('forecast-2100', 'dataset=pop2100&projection=map&theme=light&cam=20,10,2.2,45,0')
await shot('data-modal', 'dataset=pop2025&theme=dark', { panel: true, settle: 800, after: async (p) => {
  await p.click('[data-testid=open-data]'); await p.waitForSelector('[data-testid=data-modal]') } })
await shot('csv-modal', 'dataset=pop2025&theme=light', { panel: true, settle: 800, after: async (p) => {
  await p.click('[data-testid=open-upload]'); await p.waitForSelector('[data-testid=csv-modal]')
  const csv = LANG === 'ru' ? 'Страна;Год;ВВП, $ трлн\nРоссия;2015;1,36\nРоссия;2024;2,17\nКазахстан;2024;0,29\nБеларусь;2024;0,08' : 'Country,Year,GDP $ trn\nRussia,2015,1.36\nRussia,2024,2.17\nKazakhstan,2024,0.29\nBelarus,2024,0.08'
  await p.$eval('[data-testid=csv-text]', (el, csv) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, csv)
    el.dispatchEvent(new Event('input', { bubbles: true })) }, csv) } })
await shot('mobile', 'dataset=pop2025&theme=dark', { mobile: true, settle: 1500, after: async (p) => {
  await p.click('[data-testid=show-panel]'); await p.waitForSelector('[data-testid=panel]') } })
await browser.close()
console.log(errors.length ? `JS-ошибки: ${errors.join('; ')}` : 'JS-ошибок: 0')
