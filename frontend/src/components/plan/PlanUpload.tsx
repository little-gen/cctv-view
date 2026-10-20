import { FileUp } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { useUploadPlanImage } from '@/api/hooks';
import { ErrorText } from '@/components/ui/Modal';
import { pdfToPng } from '@/lib/pdfToImage';

/** Zona para subir/sustituir la imagen de un plano. Acepta PNG, JPG y PDF (se rasteriza en el navegador). */
export function PlanUpload({ projectId, planId, onDone, compact }: { projectId: string; planId: string; onDone?: (warning?: string) => void; compact?: boolean }) {
  const upload = useUploadPlanImage(projectId);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [over, setOver] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      let img = file;
      if (file.type === 'application/pdf') {
        setConverting(true);
        img = await pdfToPng(file);
      }
      const res = await upload.mutateAsync({ planId, file: img });
      onDone?.(res.warning);
    } catch (err) {
      setError(err);
    } finally {
      setConverting(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files[0]);
  };

  const busy = converting || upload.isPending;
  return (
    <div className={compact ? '' : 'grid h-full place-items-center p-6'}>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex w-full max-w-lg cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${over ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'}`}
      >
        <FileUp className="size-8 text-muted" />
        <span className="font-medium">{busy ? (converting ? 'Convirtiendo PDF…' : 'Subiendo…') : 'Arrastra aquí el plano de la nave'}</span>
        <span className="text-sm text-muted">PNG, JPG o PDF (se usa la primera página)</span>
        <input type="file" hidden accept="image/png,image/jpeg,application/pdf" disabled={busy} onChange={(e) => handle(e.target.files?.[0])} />
      </label>
      <ErrorText error={error} />
    </div>
  );
}
