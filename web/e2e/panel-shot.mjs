// Скриншоты панели настроек (дизайн-ревью): node e2e/panel-shot.mjs [url] [out-prefix]
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const BASE = (process.argv[2] || 'http://localhost:8105').replace(/\/$/, '')
const OUT = process.argv[3] || 'e2e/shots-panel/now'
mkdirSync(OUT.replace(/\/[^/]*$/, ''), { recursive: true })
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
for (const [name, vp, q] of [['desktop', { width: 1440, height: 900 }, ''], ['light', { width: 1440, height: 900 }, '&theme=light'],
  ['mobile', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, '']]) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewport(vp)
  await page.goto(`${BASE}/?dataset=pop2025${q}`, { waitUntil: 'networkidle2', timeout: 90000 })
  await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: `${OUT}-${name}.png` })
  if (name === 'mobile') {             // на телефоне панель свёрнута — открыть шторку
    await page.click('[data-testid=show-panel]'); await new Promise((r) => setTimeout(r, 500))
    await page.screenshot({ path: `${OUT}-${name}-open.png` })
  } else {                             // всплывающий список поверх панели
    await page.click('[data-testid=focus-select]'); await new Promise((r) => setTimeout(r, 300))
    await page.screenshot({ path: `${OUT}-${name}-select.png`, clip: { x: 1040, y: 0, width: 400, height: 900 }, captureBeyondViewport: false })
    await page.keyboard.press('Escape')
    await page.$eval('[data-testid=panel] .gv-scroll', (e) => { e.scrollTop = e.scrollHeight }); await new Promise((r) => setTimeout(r, 300))
    await page.click('[data-testid=palette-select]'); await new Promise((r) => setTimeout(r, 300))
    await page.screenshot({ path: `${OUT}-${name}-bottom.png`, clip: { x: 1040, y: 0, width: 400, height: 900 }, captureBeyondViewport: false })
    await page.keyboard.press('Escape')
  }
  const panel = await page.$('[data-testid=panel]')
  if (panel) await panel.screenshot({ path: `${OUT}-${name}-panel.png` }).catch(() => {})
  await page.close()
}
await browser.close()
console.log(errors.length ? `JS-ошибки: ${errors.join('; ')}` : 'JS-ошибок: 0')
