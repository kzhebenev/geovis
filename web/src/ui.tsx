/**
 * Элементы панели настроек в едином стиле (цвета — CSS-переменные .gv-ui, см. index.css):
 * группа, поле, сегменты, выпадающий список, переключатель, ползунок, иконка-кнопка.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X, type LucideIcon } from 'lucide-react'

/** Сворачиваемая группа; состояние запоминается в браузере (только удобство, не данные). */
export function Group({ id, title, icon: Icon, children, defaultOpen = true }: {
  id: string; title: string; icon?: LucideIcon; children: ReactNode; defaultOpen?: boolean
}) {
  const key = `geovis.block.${id}`
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v !== '0' } catch { return defaultOpen }
  })
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? '0' : '1') } catch { /* приватный режим */ } return !o })
  return (
    <section className="border-t border-[var(--p-divider)]" data-testid={`block-${id}`}>
      <button type="button" onClick={toggle} aria-expanded={open} data-testid={`block-toggle-${id}`}
        className="gv-focus group flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-semibold text-[var(--p-text)]">
        {Icon && <Icon size={15} className="text-[var(--p-muted)]" />}
        <span className="flex-1">{title}</span>
        <ChevronDown size={15} className={`text-[var(--p-faint)] transition-transform group-hover:text-[var(--p-muted)] ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="space-y-3.5 px-4 pb-4">{children}</div>}
    </section>
  )
}

/** Подпись поля сверху, справа — необязательное значение. */
export function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-[var(--p-muted)]">{label}</span>
        {value !== undefined && <span className="font-medium tabular-nums text-[var(--p-text)]">{value}</span>}
      </div>
      {children}
    </div>
  )
}

export interface SegOption<T> { value: T; label?: ReactNode; icon?: LucideIcon; title?: string; testid?: string }

/** Сегменты: все варианты видны сразу, выбранный — приподнятая «таблетка». Для 2–5 вариантов. */
export function Segmented<T extends string | number>({ value, options, onChange, size = 'md', stack = false }: {
  value: T; options: SegOption<T>[]; onChange: (v: T) => void; size?: 'sm' | 'md'
  stack?: boolean                 // столбиком — для длинных подписей
}) {
  return (
    <div className={`flex rounded-[10px] bg-[var(--p-ctl)] p-[3px] ${stack ? 'flex-col' : ''} ${size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]'}`} role="group">
      {options.map((o) => {
        const on = o.value === value
        const Icon = o.icon
        return (
          <button key={String(o.value)} type="button" data-testid={o.testid} aria-pressed={on} title={o.title}
            onClick={() => onChange(o.value)}
            className={`gv-focus flex min-w-0 items-center gap-1.5 rounded-[7px] font-medium transition-colors ${stack ? 'justify-start px-2.5' : 'flex-1 justify-center'} ${
              size === 'sm' ? 'h-6 px-2' : 'h-7 px-2'} ${on
                ? 'bg-[var(--p-thumb)] text-[var(--p-text)] shadow-[var(--p-thumb-shadow)]'
                : 'text-[var(--p-muted)] hover:text-[var(--p-text)]'}`}>
            {Icon && <Icon size={14} className="shrink-0" />}
            {o.label !== undefined && <span className="truncate">{o.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

export interface SelectOption<T> {
  value: T; label: string; hint?: string; testid?: string
  swatch?: string                 // CSS-фон образца (градиент палитры)
}

/** Выпадающий список в стиле панели: всплывает поверх (портал), клавиатура ↑↓ Enter Esc, Home/End. */
export function Select<T extends string | number>({ value, options, onChange, testid, theme, placeholder, disabled }: {
  value: T | null; options: SelectOption<T>[]; onChange: (v: T) => void; testid?: string
  theme: 'dark' | 'light'; placeholder?: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const uid = useId()
  const cur = options.find((o) => o.value === value)

  const place = () => {
    const r = btn.current!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12
    const want = Math.min(320, options.length * 34 + 8)
    const width = Math.max(r.width, 200)
    const left = Math.min(r.left, window.innerWidth - width - 8)
    setPos(below >= want || below >= above
      ? { left, width, top: r.bottom + 6, maxH: Math.min(320, below) }
      : { left, width, bottom: window.innerHeight - r.top + 6, maxH: Math.min(320, above) })
  }
  const show = () => { if (disabled) return; place(); setHi(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true) }
  const pick = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); btn.current?.focus() }

  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null) => t instanceof Node && (list.current?.contains(t) || btn.current?.contains(t))
    const down = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false) }
    const scroll = (e: Event) => { if (!(e.target instanceof Node && list.current?.contains(e.target))) setOpen(false) }
    const resize = () => setOpen(false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])
  useLayoutEffect(() => {   // выбранный пункт — в видимой части списка
    // не scrollIntoView: он прокручивает и панель под списком, а прокрутка снаружи закрывает список
    const box = list.current, el = box?.querySelector<HTMLElement>(`[data-i="${hi}"]`)
    if (!open || !box || !el) return
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop - 4
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight + 4
  }, [open, hi])

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    const last = options.length - 1
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(last, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0) }
    else if (e.key === 'End') { e.preventDefault(); setHi(last) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(hi) }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); setOpen(false) }
  }

  return (
    <>
      <button ref={btn} type="button" data-testid={testid} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? uid : undefined}
        aria-activedescendant={open ? `${uid}-${hi}` : undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}
        className={`gv-focus flex h-8 w-full items-center gap-2 rounded-[9px] bg-[var(--p-ctl)] px-2.5 text-left text-[13px] transition-colors hover:bg-[var(--p-ctl-hover)] disabled:opacity-45 ${
          open ? 'ring-1 ring-[var(--p-accent)]' : ''}`}>
        {cur?.swatch && <span className="h-3.5 w-10 shrink-0 rounded-[4px]" style={{ background: cur.swatch }} />}
        <span className={`flex-1 truncate ${cur ? 'text-[var(--p-text)]' : 'text-[var(--p-faint)]'}`}>{cur?.label ?? placeholder}</span>
        {cur?.hint && <span className="shrink-0 text-[11.5px] text-[var(--p-faint)]">{cur.hint}</span>}
        <ChevronDown size={15} className={`shrink-0 text-[var(--p-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={list} id={uid} role="listbox" data-theme={theme} data-testid={testid ? `${testid}-list` : undefined}
          className="gv-ui gv-pop gv-scroll fixed z-[60] overflow-y-auto rounded-xl border border-[var(--p-border)] bg-[var(--p-pop)] p-1 shadow-[var(--p-shadow)]"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}>
          {options.map((o, i) => {
            const sel = o.value === value
            return (
              <div key={String(o.value)} id={`${uid}-${i}`} data-i={i} role="option" aria-selected={sel} data-testid={o.testid}
                onPointerEnter={() => setHi(i)} onClick={() => pick(i)}
                className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] ${
                  i === hi ? 'bg-[var(--p-ctl-hover)]' : ''} ${sel ? 'font-medium' : ''}`}>
                {o.swatch && <span className="h-3.5 w-12 shrink-0 rounded-[4px]" style={{ background: o.swatch }} />}
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-[11.5px] text-[var(--p-faint)]">{o.hint}</span>}
                <Check size={14} className={`shrink-0 text-[var(--p-accent)] ${sel ? '' : 'invisible'}`} />
              </div>
            )
          })}
        </div>, document.body)}
    </>
  )
}

/** Строка «подпись — переключатель». */
export function Toggle({ label, checked, onChange, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-pressed={checked} data-testid={testid} onClick={() => onChange(!checked)}
      className="gv-focus flex w-full items-center justify-between rounded-lg py-1 text-[13px] text-[var(--p-text)]">
      <span>{label}</span>
      <span className={`relative h-[18px] w-8 rounded-full transition-colors ${checked ? 'bg-[var(--p-accent)]' : 'bg-[var(--p-ctl-hover)]'}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left] ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
      </span>
    </button>
  )
}

/** Ползунок с заливкой до значения и подписями краёв. */
export function Slider({ min, max, step, value, onChange, testid, edges = true, disabled }: {
  min: number; max: number; step: number; value: number; onChange: (v: number) => void
  testid?: string; edges?: boolean; disabled?: boolean
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div className="flex items-center gap-2.5">
      {edges && <span className="text-[11px] tabular-nums text-[var(--p-faint)]">{min}</span>}
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))} className="gv-range flex-1"
        style={{ '--fill': `${fill}%` } as React.CSSProperties} />
      {edges && <span className="text-[11px] tabular-nums text-[var(--p-faint)]">{max}</span>}
    </div>
  )
}

/** Квадратная кнопка-иконка (панель инструментов). */
export function IconButton({ icon: Icon, title, onClick, disabled, testid, active, label }: {
  icon: LucideIcon; title: string; onClick: () => void; disabled?: boolean; testid?: string; active?: boolean; label?: string
}) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled} data-testid={testid}
      className={`gv-focus flex h-8 items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-medium transition-colors disabled:opacity-40 ${
        label ? 'px-2.5' : 'w-8'} ${active
          ? 'bg-[var(--p-accent-soft)] text-[var(--p-accent)]'
          : 'bg-[var(--p-ctl)] text-[var(--p-muted)] hover:bg-[var(--p-ctl-hover)] hover:text-[var(--p-text)] disabled:hover:bg-[var(--p-ctl)]'}`}>
      <Icon size={15} />
      {label && <span>{label}</span>}
    </button>
  )
}

/** Окно поверх сцены в стиле панели: затемнение, карточка, шапка с иконкой, Esc и клик по фону — закрыть.
 *  Портал в body: у панели backdrop-filter, он делает её контейнером для position: fixed. */
export function Modal({ theme, icon: Icon, title, subtitle, onClose, testid, width = 'max-w-3xl', children, footer, label }: {
  theme: 'dark' | 'light'; icon: LucideIcon; title: ReactNode; subtitle?: ReactNode; onClose: () => void; testid: string
  width?: string; children: ReactNode; footer?: ReactNode; label?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className={`fixed inset-0 z-50 grid place-items-center p-3 backdrop-blur-[3px] sm:p-6 ${theme === 'light' ? 'bg-slate-900/25' : 'bg-black/55'}`}
      onClick={onClose} data-testid={testid}>
      <div role="dialog" aria-label={label} data-theme={theme} onClick={(e) => e.stopPropagation()}
        className={`gv-ui gv-pop flex max-h-[88vh] w-full ${width} flex-col overflow-hidden rounded-2xl bg-[var(--p-pop)] shadow-[var(--p-shadow)]`}>
        <header className="flex items-center gap-3 px-5 pb-3 pt-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--p-accent-soft)] text-[var(--p-accent)]"><Icon size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{title}</div>
            {subtitle && <div className="truncate text-[12px] text-[var(--p-muted)]">{subtitle}</div>}
          </div>
          <IconButton icon={X} title="Esc" onClick={onClose} testid={`${testid}-close`} />
        </header>
        <div className="gv-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--p-divider)] px-5 py-3">{footer}</footer>}
      </div>
    </div>, document.body)
}

/** Основная (акцентная) и вторичная кнопки окон. */
export function Button({ children, onClick, disabled, testid, variant = 'primary', icon: Icon, full }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; testid?: string
  variant?: 'primary' | 'secondary'; icon?: LucideIcon; full?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testid}
      className={`gv-focus flex h-9 items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold transition disabled:opacity-40 ${full ? 'w-full' : ''} ${
        variant === 'primary'
          ? 'bg-[var(--p-accent)] text-[var(--p-accent-fg)] shadow-sm hover:bg-[var(--p-accent-strong)] disabled:hover:bg-[var(--p-accent)]'
          : 'bg-[var(--p-ctl)] text-[var(--p-text)] hover:bg-[var(--p-ctl-hover)]'}`}>
      {Icon && <Icon size={15} />}{children}
    </button>
  )
}

/** Поле ввода в стиле панели (input и textarea). */
export const inputCls = 'w-full rounded-[10px] bg-[var(--p-ctl)] px-3 py-2 text-[13px] text-[var(--p-text)] outline-none ring-1 ring-transparent transition placeholder:text-[var(--p-faint)] focus:ring-[var(--p-accent)]'
