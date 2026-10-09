import { CircleHelp, Download, Film, Pause, Play, Plus, Square, Upload } from 'lucide-react'
import { useRef } from 'react'
import type { Lang } from './settings'
import { duration, type Scenario } from './scenario'
import { IconButton, Select } from './ui'
import { t } from './i18n'

interface Props {
  lang: Lang
  theme: 'dark' | 'light'
  scenarios: Scenario[]          // готовые + свой (если есть)
  active: Scenario | null
  time: number
  duration: number
  playing: boolean
  onPick: (id: string) => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSeek: (t: number) => void
  onAddKeyframe: () => void
  onExport: () => void
  onImport: (text: string) => void
  onVideo: () => void
  onHelp: () => void
}

/** Раздел панели «Сценарий»: выбор, ▶/⏸/⏹, шкала времени, запись кадров, экспорт/импорт JSON. */
export default function Player(p: Props) {
  const file = useRef<HTMLInputElement>(null)
  const L = (k: Parameters<typeof t>[1]) => t(p.lang, k)
  const fill = p.duration > 0 ? (p.time / p.duration) * 100 : 0
  return (
    <div className="space-y-3" data-testid="player">
      <Select theme={p.theme} testid="scenario-select" value={p.active?.id ?? null} placeholder={L('pickScenario')}
        onChange={p.onPick}
        options={p.scenarios.map((s) => ({ value: s.id, label: s.title[p.lang], testid: `scenario-${s.id}`,
          hint: `${Math.round(duration(s))} ${L('sec')}` }))} />
      <div className="flex items-center gap-2.5">
        {p.playing
          ? <button type="button" data-testid="pause" onClick={p.onPause} title="Pause"
              className="gv-focus grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--p-accent)] text-[var(--p-accent-fg)] shadow-md transition hover:bg-[var(--p-accent-strong)]">
              <Pause size={16} fill="currentColor" /></button>
          : <button type="button" data-testid="play" disabled={!p.active} onClick={p.onPlay} title="Play"
              className="gv-focus grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--p-accent)] text-[var(--p-accent-fg)] shadow-md transition hover:bg-[var(--p-accent-strong)] disabled:bg-[var(--p-ctl-hover)] disabled:text-[var(--p-faint)] disabled:shadow-none">
              <Play size={16} fill="currentColor" className="translate-x-[1px]" /></button>}
        <div className="min-w-0 flex-1">
          <input type="range" min={0} max={Math.max(p.duration, 0.1)} step={0.1} value={p.time} disabled={!p.active}
            onChange={(e) => p.onSeek(Number(e.target.value))} className="gv-range" data-testid="timeline"
            style={{ '--fill': `${fill}%` } as React.CSSProperties} />
          <div className="flex justify-between text-[11px] tabular-nums text-[var(--p-faint)]" data-testid="time">
            <span>{p.time.toFixed(1)} {L('sec')}</span><span>{p.duration.toFixed(0)} {L('sec')}</span>
          </div>
        </div>
        <IconButton icon={Square} title="Stop" testid="stop" disabled={!p.active} onClick={p.onStop} />
      </div>
      <div className="flex items-center gap-1.5">
        <IconButton icon={Plus} label={L('addKey')} title={L('addKeyHint')} testid="add-keyframe" onClick={p.onAddKeyframe} />
        <IconButton icon={Film} label={L('video')} title={L('videoHint')} testid="video" disabled={!p.active} onClick={p.onVideo} />
        <span className="flex-1" />
        <IconButton icon={Download} title={L('exportJson')} testid="export" disabled={!p.active} onClick={p.onExport} />
        <IconButton icon={Upload} title={L('importJson')} testid="import" onClick={() => file.current?.click()} />
        <IconButton icon={CircleHelp} title={L('help')} testid="help" onClick={p.onHelp} />
        <input ref={file} type="file" accept="application/json,.json" className="hidden"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) p.onImport(await f.text()); e.target.value = '' }} />
      </div>
      {p.active && <div className="text-[11px] text-[var(--p-faint)]">{L('keyframes')}: {p.active.keyframes.length}</div>}
    </div>
  )
}
