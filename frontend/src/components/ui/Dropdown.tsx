import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Dropdown({ trigger, children, align = 'right' }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={`panel absolute top-full z-40 mt-1 min-w-56 p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          onClick={(e) => (e.target as HTMLElement).closest('[data-close]') && setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, active }: { icon?: ReactNode; children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      data-close
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-3 ${active ? 'text-ink' : 'text-ink-2'}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuToggle({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-3">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent" />
      {children}
    </label>
  );
}
