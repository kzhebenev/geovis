// Скриншоты окон (дизайн-ревью): node e2e/modal-shot.mjs [url] [out-prefix]
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const BASE = (process.argv[2] || 'http://localhost:8105').replace(/\/$/, '')
const OUT = process.argv[3] || 'e2e/shots-panel/modal'
mkdirSync(OUT.replace(/\/[^/]*$/, ''), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${BASE}/?dataset=pop2025&theme=${theme}`, { waitUntil: 'networkidle2', timeout: 90000 })
  await page.waitForFunction(() => window.__geovis?.ready, { timeout: 90000 })
  await page.click('[data-testid=open-data]'); await page.waitForSelector('[data-testid=data-modal]'); await sleep(400)
  await page.screenshot({ path: `${OUT}-${theme}-data.png` }); await page.keyboard.press('Escape'); await sleep(200)
  await page.click('[data-testid=open-upload]'); await page.waitForSelector('[data-testid=csv-modal]')
  await page.$eval('[data-testid=csv-text]', (el) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Страна;Год;ВВП\nРоссия;2015;1,36\nРоссия;2024;2,19\nКазахстан;2024;0,29\nАтлантида;2024;9')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }); await sleep(400)
  await page.screenshot({ path: `${OUT}-${theme}-csv.png` }); await page.keyboard.press('Escape'); await sleep(200)
  await page.click('[data-testid=scenario-select]'); await page.click('[data-testid=scenario-orbit]').catch(async () => {
    const first = await page.$('[data-testid=scenario-select-list] [role=option]'); await first.click() })
  await sleep(300); await page.click('[data-testid=pause]').catch(() => {})
  await page.click('[data-testid=video]'); await page.waitForSelector('[data-testid=video-modal]'); await sleep(300)
  await page.screenshot({ path: `${OUT}-${theme}-video.png` }); await page.keyboard.press('Escape'); await sleep(200)
  await page.click('[data-testid=help]'); await page.waitForSelector('[data-testid=scenario-help]'); await sleep(300)
  await page.screenshot({ path: `${OUT}-${theme}-help.png` })
  await page.close()
}
await browser.close()
console.log(errors.length ? `JS-ошибки: ${errors.join('; ')}` : 'JS-ошибок: 0')
