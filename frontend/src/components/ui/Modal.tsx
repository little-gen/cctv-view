import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel max-h-[90vh] w-full overflow-auto shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost px-1.5" onClick={onClose} aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  // Errores de validación de la API: se muestran los motivos concretos
  const details = (error as { details?: unknown }).details;
  const reasons = Array.isArray(details) ? details.map((d: { message?: string }) => d.message).filter(Boolean) : [];
  return (
    <p className="mt-2 text-sm text-red-300" role="alert">
      {reasons.length ? reasons.join('. ') : error instanceof Error ? error.message : String(error)}
    </p>
  );
}
