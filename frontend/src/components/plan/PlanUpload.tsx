import { FileUp } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { useUploadPlanImage } from '@/api/hooks';
import { ErrorText } from '@/components/ui/Modal';
import { pdfToPng } from '@/lib/pdfToImage';

/** Debe coincidir con PLAN_MAX_UPLOAD_MB del servidor (y client_max_body_size de nginx). */
const PLAN_MAX_MB = 200;

type Phase = { kind: 'idle' } | { kind: 'converting' } | { kind: 'uploading'; progress: number } | { kind: 'processing' };

/**
 * Zona para subir/sustituir la imagen de un plano. Acepta PNG, JPG, WebP, TIFF y PDF
 * (el PDF se rasteriza en el navegador). El servidor genera después los niveles de zoom.
 */
export function PlanUpload({ projectId, planId, onDone, compact }: { projectId: string; planId: string; onDone?: (warning?: string) => void; compact?: boolean }) {
  const upload = useUploadPlanImage(projectId);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);
  const [over, setOver] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      let img = file;
      if (file.type === 'application/pdf') {
        setPhase({ kind: 'converting' });
        img = await pdfToPng(file);
      }
      if (img.size > PLAN_MAX_MB * 1024 * 1024) {
        throw new Error(`El plano ocupa ${(img.size / 1024 / 1024).toFixed(0)} MB; el máximo es ${PLAN_MAX_MB} MB`);
      }
      setPhase({ kind: 'uploading', progress: 0 });
      const res = await upload.mutateAsync({
        planId,
        file: img,
        // Al terminar de enviar, el servidor genera las teselas (unos segundos en planos grandes)
        onProgress: (p) => setPhase(p >= 1 ? { kind: 'processing' } : { kind: 'uploading', progress: p }),
      });
      onDone?.(res.warning);
    } catch (err) {
      setError(err);
    } finally {
      setPhase({ kind: 'idle' });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files[0]);
  };

  const busy = phase.kind !== 'idle';
  const label = {
    idle: 'Arrastra aquí el plano de la nave',
    converting: 'Convirtiendo PDF a imagen…',
    uploading: `Subiendo… ${phase.kind === 'uploading' ? Math.round(phase.progress * 100) : 0} %`,
    processing: 'Generando niveles de zoom…',
  }[phase.kind];

  return (
    <div className={compact ? '' : 'grid h-full place-items-center p-6'}>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        aria-busy={busy}
        className={`flex w-full max-w-lg cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${over ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'} ${busy ? 'cursor-progress' : ''}`}
      >
        <FileUp className="size-8 text-muted" />
        <span className="font-medium" aria-live="polite">{label}</span>
        {busy ? (
          <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-3" role="progressbar"
            aria-valuenow={phase.kind === 'uploading' ? Math.round(phase.progress * 100) : undefined}>
            <div
              className={`h-full rounded-full bg-accent transition-[width] ${phase.kind === 'uploading' ? '' : 'w-1/3 animate-pulse'}`}
              style={phase.kind === 'uploading' ? { width: `${phase.progress * 100}%` } : undefined}
            />
          </div>
        ) : (
          <span className="text-sm text-muted">PNG, JPG, TIFF, WebP o PDF (primera página) · hasta {PLAN_MAX_MB} MB, sin límite práctico de resolución</span>
        )}
        <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/tiff,application/pdf" disabled={busy} onChange={(e) => handle(e.target.files?.[0])} />
      </label>
      <ErrorText error={error} />
    </div>
  );
}
