import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Download, Film, Monitor, Smartphone } from 'lucide-react'
import type { Lang } from './settings'
import { duration, type Scenario } from './scenario'
import { Button, Field, Modal, Segmented } from './ui'

interface Job { id: string; state: 'queued' | 'rendering' | 'done' | 'error'; frame: number; frames: number;
  queue_position: number; eta_s: number | null; error: string | null; bytes: number | null }

const QUALITIES = [
  { id: '720p', w: 1280, h: 720, label: '720p' }, { id: '1080p', w: 1920, h: 1080, label: '1080p' },
  // вертикальные — для Shorts / Reels / TikTok
  { id: '720p_v', w: 720, h: 1280, label: '9:16 720' }, { id: '1080p_v', w: 1080, h: 1920, label: '9:16 1080' },
] as const
const FPS = [24, 30] as const

/** Выгрузка сценария в MP4: покадровый рендер на сервере (без видеокарты — небыстро), прогресс, скачивание. */
export default function VideoModal({ lang, theme, scenario, onClose }: { lang: Lang; theme: 'dark' | 'light'; scenario: Scenario; onClose: () => void }) {
  const ru = lang === 'ru'
  const [q, setQ] = useState<(typeof QUALITIES)[number]['id']>('720p')
  const [fps, setFps] = useState<(typeof FPS)[number]>(30)
  const [job, setJob] = useState<Job | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const dur = duration(scenario)
  const frames = Math.round(dur * fps) + 1

  useEffect(() => () => window.clearInterval(timer.current), [])

  async function start() {
    setErr(null)
    const r = await fetch('/api/v1/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, fps, quality: q }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.status)); return }
    setJob(j)
    timer.current = window.setInterval(async () => {
      const s = await fetch(`/api/v1/videos/${j.id}`).then((x) => x.json()).catch(() => null)
      if (!s) return
      setJob(s)
      if (s.state === 'done' || s.state === 'error') window.clearInterval(timer.current)
    }, 2000)
  }

  const pct = job && job.frames ? Math.round((job.frame / job.frames) * 100) : 0
  const mins = (s: number) => (s >= 90 ? `${Math.round(s / 60)} ${ru ? 'мин' : 'min'}` : `${s} ${ru ? 'с' : 's'}`)
  const eta = mins(Math.round(frames * (q.startsWith('1080') ? 2.5 : 1.2)))
  const stat = (k: string, v: string) => (
    <div className="rounded-xl bg-[var(--p-ctl)] px-3 py-2">
      <div className="text-[11px] text-[var(--p-muted)]">{k}</div>
      <div className="text-[14px] font-semibold tabular-nums">{v}</div>
    </div>
  )

  return (
    <Modal theme={theme} icon={Film} width="max-w-md" testid="video-modal" onClose={onClose}
      title={ru ? 'Видео сценария' : 'Scenario video'} subtitle={scenario.title[lang]}>
      {!job && (
        <div className="space-y-4">
          <Field label={ru ? 'Качество' : 'Quality'}>
            <Segmented value={q} onChange={setQ} options={QUALITIES.map((x) => ({
              value: x.id, testid: `q-${x.id}`, icon: x.h > x.w ? Smartphone : Monitor, title: `${x.w}×${x.h}`,
              label: x.h > x.w ? x.label.replace('9:16 ', '') : x.label }))} />
            <div className="mt-1 text-[11px] text-[var(--p-faint)]">{ru ? 'телефон — вертикальное 9:16 для Shorts, Reels, TikTok' : 'phone — vertical 9:16 for Shorts, Reels, TikTok'}</div>
          </Field>
          <Field label={ru ? 'Кадров в секунду' : 'Frames per second'}>
            <Segmented value={fps} onChange={setFps} options={FPS.map((x) => ({ value: x, label: String(x), testid: `fps-${x}` }))} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            {stat(ru ? 'Длительность' : 'Duration', `${dur.toFixed(0)} ${ru ? 'с' : 's'}`)}
            {stat(ru ? 'Кадров' : 'Frames', String(frames))}
            {stat(ru ? 'Рендер' : 'Render', `~${eta}`)}
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
            {ru ? 'Рендер идёт на сервере без видеокарты. Не закрывайте окно до конца — ссылка на файл появится здесь.'
              : 'Rendered on a server without GPU. Keep this window open — the download link will appear here.'}
          </p>
          {err && <div className="rounded-xl bg-red-500/12 px-3 py-2 text-[13px] text-red-500 ring-1 ring-red-500/30" data-testid="video-error">{err}</div>}
          <Button full icon={Clapperboard} testid="video-start" onClick={start}>{ru ? 'Записать MP4' : 'Render MP4'}</Button>
        </div>
      )}
      {job && (
        <div data-testid="video-progress" className="space-y-3">
          <div className="flex items-baseline justify-between text-[12px] text-[var(--p-muted)]">
            <span className="font-medium text-[var(--p-text)]">{job.state === 'queued' ? (ru ? `В очереди: ${job.queue_position}` : `Queued: ${job.queue_position}`)
              : job.state === 'rendering' ? `${ru ? 'Кадр' : 'Frame'} ${job.frame} / ${job.frames}` : job.state === 'done' ? (ru ? 'Готово' : 'Done') : (ru ? 'Ошибка' : 'Error')}</span>
            {job.eta_s !== null && job.state === 'rendering' && <span>{ru ? 'осталось' : 'left'} ~{mins(job.eta_s)}</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--p-ctl-hover)]">
            <div className={`h-full rounded-full transition-[width] ${job.state === 'error' ? 'bg-red-500' : 'bg-[var(--p-accent)]'}`}
              style={{ width: `${job.state === 'done' ? 100 : pct}%` }} />
          </div>
          {job.state === 'done' && (
            <a href={`/api/v1/videos/${job.id}.mp4`} download={`geovis-${scenario.id}.mp4`} data-testid="video-download"
              className="gv-focus flex h-10 items-center justify-center gap-2 rounded-[10px] bg-emerald-600 text-[13px] font-semibold text-white shadow-sm transition hover:bg-emerald-500">
              <Download size={16} /> {ru ? 'Скачать MP4' : 'Download MP4'} {job.bytes ? `· ${(job.bytes / 1e6).toFixed(1)} ${ru ? 'МБ' : 'MB'}` : ''}
            </a>
          )}
          {job.state === 'error' && <div className="rounded-xl bg-red-500/12 px-3 py-2 text-[13px] text-red-500 ring-1 ring-red-500/30">{job.error}</div>}
        </div>
      )}
    </Modal>
  )
}
