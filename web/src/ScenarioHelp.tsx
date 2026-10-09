import { useState } from 'react'
import { Button, Modal } from './ui'
import { BookOpen, Copy, Play } from 'lucide-react'
import type { Lang } from './settings'

/** Шаблон сценария: из него удобно начинать (облёт Москвы с титрами и сменой года). */
export const SCENARIO_TEMPLATE = {
  title: { ru: 'Мой сценарий', en: 'My scenario' },
  keyframes: [
    { t: 0, camera: { longitude: 60, latitude: 50, zoom: 2.2, pitch: 20, bearing: 0 },
      settings: { dataset: 'pop1975', focus: 'world', mode: 'columns', theme: 'dark', projection: 'map', scale: 'sqrt' },
      caption: { ru: 'Население, 1975', en: 'Population, 1975' } },
    { t: 5, camera: { longitude: 37.62, latitude: 55.75, zoom: 4, pitch: 55, bearing: 20 }, easing: 'inOutCubic', caption: null },
    { t: 8, camera: { longitude: 37.62, latitude: 55.75, zoom: 4, pitch: 55, bearing: 60 }, easing: 'linear',
      settings: { dataset: 'pop2025' }, caption: { ru: '2025', en: '2025' } },
    { t: 13, camera: { longitude: 37.62, latitude: 55.75, zoom: 4, pitch: 55, bearing: 160 }, easing: 'linear' },
  ],
}

const code = 'rounded-md bg-[var(--p-ctl-hover)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--p-accent)]'

export default function ScenarioHelp({ lang, theme, onClose, onUseTemplate }: {
  lang: Lang; theme: 'dark' | 'light'; onClose: () => void; onUseTemplate: (json: unknown) => void
}) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(SCENARIO_TEMPLATE, null, 2)
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* нет доступа к буферу */ }
  }
  const ru = lang === 'ru'
  const footer = (
    <>
      <Button variant="secondary" icon={Copy} onClick={copy}>{copied ? (ru ? 'Скопировано' : 'Copied') : (ru ? 'Скопировать шаблон' : 'Copy template')}</Button>
      <Button icon={Play} testid="use-template" onClick={() => { onUseTemplate(SCENARIO_TEMPLATE); onClose() }}>
        {ru ? 'Открыть шаблон в редакторе' : 'Open template in editor'}</Button>
    </>
  )
  return (
    <Modal theme={theme} icon={BookOpen} testid="scenario-help" onClose={onClose} footer={footer}
      title={ru ? 'Как написать сценарий полёта' : 'How to write a flight scenario'}
      subtitle={ru ? 'Ключевые кадры, смена сцены, титры' : 'Keyframes, scene changes, captions'}>
        <div className="space-y-5 text-[13.5px] leading-relaxed">
          {ru ? (
            <>
              <section>
                <h3 className="mb-1.5 text-[14px] font-semibold">1. Быстро, без JSON</h3>
                <p>Поставьте камеру мышью (левая кнопка — сдвиг, правая или Ctrl — наклон и поворот, колесо — приближение),
                  выберите набор и вид → нажмите <b>«+ Кадр»</b>. Повторите для следующих ракурсов: каждый новый кадр — через 5 с.
                  Нажмите ▶. Чтобы поправить время или добавить титры — кнопкой <b>⤓ «Скачать сценарий»</b>, отредактируйте файл и загрузите обратно кнопкой <b>⤒ «Загрузить сценарий»</b>.</p>
              </section>
              <section>
                <h3 className="mb-1.5 text-[14px] font-semibold">2. Ключевой кадр</h3>
                <ul className="list-disc space-y-1 pl-5">
                  <li><span className={code}>t</span> — секунда, когда камера приходит в этот ракурс (по возрастанию).</li>
                  <li><span className={code}>camera.longitude / latitude</span> — точка, <b>на которую смотрит</b> камера (не где она висит).
                    Для облёта вокруг города оставьте точку и меняйте только <span className={code}>bearing</span>.</li>
                  <li><span className={code}>zoom</span>: 1 — вся Земля, 2–3 — континент или большая страна, 4–5 — регион, 6–7 — город.</li>
                  <li><span className={code}>pitch</span>: 0 — смотрим сверху, 45–65 — эффектный «пролёт», до 85 — у горизонта.</li>
                  <li><span className={code}>bearing</span>: поворот, 0 — север вверху, 90 — смотрим на восток, 180 — на юг.</li>
                  <li><span className={code}>easing</span> — как камера летит <i>к</i> кадру: <span className={code}>inOutCubic</span> (плавно, по умолчанию),
                    <span className={code}>linear</span> (ровно — для облёта), <span className={code}>inOutSine</span>, <span className={code}>outCubic</span>.</li>
                  <li>Дальние перелёты (больше 25°) идут <b>по дуге</b> — камера поднимается и снижается; <span className={code}>"arc": false</span> отключает.</li>
                </ul>
              </section>
              <section>
                <h3 className="mb-1.5 text-[14px] font-semibold">3. Смена сцены по ходу</h3>
                <p><span className={code}>settings</span> применяется в момент кадра и действует дальше: <span className={code}>dataset</span> (pop1975…pop2100, gdp2024,
                  relief, temp…), <span className={code}>countryDataset</span> (wb_gdp) и <span className={code}>year</span>, <span className={code}>focus</span> (world, RUS, KAZ, BLR, KGZ, ARM, UZB, TJK),
                  <span className={code}>mode</span>, <span className={code}>theme</span>, <span className={code}>projection</span>, <span className={code}>palette</span>, <span className={code}>scale</span>,
                  <span className={code}>smooth</span>, <span className={code}>height</span>, <span className={code}>res</span>, <span className={code}>cityMinPop</span>, <span className={code}>cityLimit</span>,
                  <span className={code}>numbers</span>, <span className={code}>showLegend</span>, <span className={code}>lang</span>.
                  Смена года каждые 2–3 с при медленном облёте — «рост мегаполисов».</p>
              </section>
              <section>
                <h3 className="mb-1.5 text-[14px] font-semibold">4. Титры</h3>
                <p><span className={code}>{'"caption": {"ru": "…", "en": "…"}'}</span> — крупный текст внизу кадра, проявляется за 0,6 с и держится до
                  следующего титра; <span className={code}>"caption": null</span> — убрать.</p>
              </section>
              <section>
                <h3 className="mb-1.5 text-[14px] font-semibold">5. Советы для роликов</h3>
                <ul className="list-disc space-y-1 pl-5">
                  <li>3–6 с на перелёт, 6–10 с на облёт; первый кадр — общий план, затем «нырок» к главному.</li>
                  <li>Перед сменой набора дайте камере 1–2 с постоять — зритель успеет заметить разницу.</li>
                  <li>Проверяйте шкалой времени: в момент t кадр всегда один и тот же — именно он попадёт в видео.</li>
                  <li>H — спрятать панель для чистого кадра; готовый сценарий — кнопка <b>«Видео»</b> (MP4).</li>
                </ul>
              </section>
              <section>
                <h3 className="mb-1.5 text-[14px] font-semibold">Шаблон</h3>
                <pre className="gv-scroll max-h-64 overflow-auto rounded-xl bg-[var(--p-ctl)] p-3 font-mono text-[11.5px] text-[var(--p-muted)]" data-testid="scenario-template">{json}</pre>
              </section>
            </>
          ) : (
            <>
              <p>Set the camera with the mouse, pick a dataset and view → <b>“+ Keyframe”</b>; repeat; press ▶. For timing and captions,
                export JSON, edit and import back.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><span className={code}>t</span> — second the camera arrives; <span className={code}>longitude/latitude</span> — the point the camera <b>looks at</b>;
                  <span className={code}>zoom</span> 1 world … 7 city; <span className={code}>pitch</span> 0 top-down … 85 horizon; <span className={code}>bearing</span> 0 north-up.</li>
                <li><span className={code}>easing</span>: inOutCubic (default), linear, inOutSine, outCubic; long flights arc automatically (<span className={code}>"arc": false</span> to disable).</li>
                <li><span className={code}>settings</span> switch the scene at the keyframe (dataset, year, focus, mode, theme…); <span className={code}>caption</span> shows a title, null hides it.</li>
              </ul>
              <pre className="gv-scroll max-h-64 overflow-auto rounded-xl bg-[var(--p-ctl)] p-3 font-mono text-[11.5px] text-[var(--p-muted)]" data-testid="scenario-template">{json}</pre>
            </>
          )}
        </div>
    </Modal>
  )
}
