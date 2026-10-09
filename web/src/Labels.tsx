import { forwardRef, useImperativeHandle, useRef } from 'react'
import { facesCamera, placeLabels, type Candidate } from './placement'

export interface LabelItem {
  key: string
  lon: number
  lat: number
  z: number          // высота привязки, м (над столбиком)
  title: string
  sub?: string
  kind: 'city' | 'country'
  priority: number
}

export interface LabelsHandle {
  /** Пересчитать положение подписей под текущую камеру (вызывается после каждого кадра). */
  update: (viewport: any, isGlobe: boolean) => void
  /** Тексты подписей, видимых сейчас на экране. */
  visible: () => string[]
}

/** HTML-подписи поверх WebGL-сцены: чёткий шрифт, анимация появления, без наложений. */
const Labels = forwardRef<LabelsHandle, { items: LabelItem[]; instant?: boolean }>(function Labels({ items, instant }, ref) {
  const els = useRef(new Map<string, HTMLDivElement>())
  const shown = useRef(new Set<string>())

  useImperativeHandle(ref, () => ({
    update(viewport, isGlobe) {
      if (!viewport) return
      const cam: number[] | undefined = viewport.cameraPosition
      const cands: Candidate[] = []
      for (const it of items) {
        const el = els.current.get(it.key)
        if (!el) continue
        const [x, y] = viewport.project([it.lon, it.lat, it.z])
        let visible = Number.isFinite(x) && Number.isFinite(y)
        if (visible && isGlobe && cam) {
          visible = facesCamera(viewport.projectPosition([it.lon, it.lat, 0]), cam)
        }
        cands.push({ key: it.key, x, y, w: el.offsetWidth, h: el.offsetHeight, priority: it.priority, visible })
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
      }
      const next = placeLabels(cands, viewport.width, viewport.height)
      for (const [key, el] of els.current) {
        const on = next.has(key)
        el.dataset.visible = on ? '1' : '0'
        el.style.opacity = on ? '1' : '0'
        el.style.scale = on ? '1' : '0.85'
      }
      shown.current = next
    },
    visible() {
      return items.filter((i) => shown.current.has(i.key)).map((i) => i.title)
    },
  }), [items])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="labels">
      {items.map((it) => (
        <div
          key={it.key}
          ref={(el) => { if (el) els.current.set(it.key, el); else els.current.delete(it.key) }}
          data-label={it.title}
          data-visible="0"
          className={`absolute left-0 top-0 whitespace-nowrap text-center opacity-0 ${instant ? '' : 'transition-[opacity,scale] duration-300'}`}
          style={{ willChange: 'transform' }}
        >
          {it.kind === 'city' ? (
            <div className="rounded-md bg-slate-950/75 px-2 py-0.5 shadow-lg ring-1 ring-white/10">
              <div className="text-[15px] font-semibold leading-tight text-white">{it.title}</div>
              {it.sub && <div className="text-[12px] font-semibold leading-tight text-amber-300">{it.sub}</div>}
            </div>
          ) : (
            <div className="[text-shadow:0_1px_3px_#000,0_0_8px_#000]">
              <div className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-sky-200/90">{it.title}</div>
              {it.sub && <div className="text-[11px] font-semibold text-sky-100/80">{it.sub}</div>}
            </div>
          )}
          {it.kind === 'city' && <div className="mx-auto h-2 w-px bg-white/70" />}
        </div>
      ))}
    </div>
  )
})

export default Labels
