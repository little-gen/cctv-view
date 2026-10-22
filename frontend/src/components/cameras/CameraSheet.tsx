import { useQueryClient } from '@tanstack/react-query';
import { Camera as CameraIcon, Download, FileText, Trash2, Upload, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { downloadFile } from '@/api/client';
import {
  qk,
  useAttachments,
  useAuthedObjectUrl,
  useCameraHistory,
  useDeleteAttachment,
  useDeleteCamera,
  useNvrs,
  useUpdateCamera,
  useUploadAttachments,
} from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ErrorText } from '@/components/ui/Modal';
import { AUDIT_ACTION_LABEL } from '@/lib/audit';
import { CAMERA_STATUS, CAMERA_STATUS_KEYS, CAMERA_TYPE_KEYS, CAMERA_TYPES } from '@/lib/cameraTypes';
import { useEditor } from '@/store/editorStore';
import type { Attachment, Camera, CameraInput } from '@/types';
import { CameraGlyph, StatusBadge } from './CameraGlyph';

type Tab = 'ficha' | 'cobertura' | 'adjuntos' | 'historial';

export function CameraSheet({ camera }: { camera: Camera }) {
  const [tab, setTab] = useState<Tab>('ficha');
  const select = useEditor((s) => s.select);

  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-surface lg:w-96" aria-label="Ficha de cámara">
      <header className="flex items-start gap-3 border-b border-line p-3">
        <CameraGlyph type={camera.type} status={camera.status} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{camera.name}</h2>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{camera.code}</span>·<span>{CAMERA_TYPES[camera.type].label}</span>·<StatusBadge status={camera.status} />
          </div>
        </div>
        <button className="btn-ghost px-1.5" onClick={() => select(null)} aria-label="Cerrar ficha">
          <X className="size-4" />
        </button>
      </header>

      <nav className="flex border-b border-line text-sm" role="tablist">
        {(['ficha', 'cobertura', 'adjuntos', 'historial'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 border-b-2 py-2 capitalize ${tab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink-2'}`}
          >
            {t}
            {t === 'adjuntos' && !!camera.attachment_count && <span className="ml-1 text-xs text-muted">({camera.attachment_count})</span>}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'ficha' && <DetailsForm key={camera.id + camera.updated_at} camera={camera} />}
        {tab === 'cobertura' && <CoverageForm camera={camera} />}
        {tab === 'adjuntos' && <AttachmentsTab camera={camera} />}
        {tab === 'historial' && <HistoryTab cameraId={camera.id} />}
      </div>
    </aside>
  );
}

// ----------------------------------------------------------------- Ficha
const TEXT_FIELDS: { key: keyof Camera; label: string; placeholder?: string; type?: string }[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'code', label: 'Código / ID' },
  { key: 'brand', label: 'Marca', placeholder: 'Hikvision, Axis, Dahua…' },
  { key: 'model', label: 'Modelo' },
  { key: 'ip_address', label: 'Dirección IP', placeholder: '192.168.1.64' },
  { key: 'mac_address', label: 'MAC', placeholder: 'AA:BB:CC:DD:EE:FF' },
  { key: 'resolution', label: 'Resolución', placeholder: '4MP, 1080p…' },
  { key: 'installed_at', label: 'Fecha de instalación', type: 'date' },
];

function DetailsForm({ camera }: { camera: Camera }) {
  const { canEdit } = useAuth();
  const update = useUpdateCamera(camera.project_id);
  const remove = useDeleteCamera(camera.project_id);
  const { data: nvrs } = useNvrs(camera.project_id);
  const select = useEditor((s) => s.select);
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...TEXT_FIELDS.map((f) => f.key), 'type', 'status', 'nvr_id', 'physical_location', 'notes'].map((k) => [
        k,
        String(camera[k as keyof Camera] ?? ''),
      ]),
    ),
  );
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Solo se envían los campos modificados; '' -> null
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v !== String(camera[k as keyof Camera] ?? '')) patch[k] = v === '' ? null : v;
    }
    if (Object.keys(patch).length) update.mutate({ id: camera.id, ...(patch as CameraInput) });
  };

  const del = () => {
    if (!confirm(`¿Eliminar la cámara ${camera.code}? Se borrarán también sus adjuntos.`)) return;
    remove.mutate(camera.id, { onSuccess: () => select(null) });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className="input" value={form.type} onChange={set('type')}>
            {CAMERA_TYPE_KEYS.map((t) => <option key={t} value={t}>{CAMERA_TYPES[t].label}</option>)}
          </select>
        </Field>
        <Field label="Estado">
          <select className="input" value={form.status} onChange={set('status')}>
            {CAMERA_STATUS_KEYS.map((s) => <option key={s} value={s}>{CAMERA_STATUS[s].label}</option>)}
          </select>
        </Field>
        {TEXT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} wide={f.key === 'name'}>
            <input className="input" type={f.type ?? 'text'} placeholder={f.placeholder} value={form[f.key]} onChange={set(f.key)} />
          </Field>
        ))}
        <Field label="NVR asociado" wide>
          <select className="input" value={form.nvr_id} onChange={set('nvr_id')}>
            <option value="">— Sin NVR —</option>
            {nvrs?.map((n) => <option key={n.id} value={n.id}>{n.name}{n.ip_address ? ` (${n.ip_address})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Ubicación física" wide>
          <input className="input" placeholder="Fachada norte, muelle 3, h=6 m…" value={form.physical_location} onChange={set('physical_location')} />
        </Field>
        <Field label="Observaciones" wide>
          <textarea className="input" rows={4} value={form.notes} onChange={set('notes')} />
        </Field>
      </fieldset>
      <ErrorText error={update.error ?? remove.error} />
      {canEdit && (
        <div className="flex justify-between gap-2 pt-1">
          <button type="button" className="btn-danger" onClick={del} disabled={remove.isPending}>
            <Trash2 className="size-4" /> Eliminar
          </button>
          <button className="btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </form>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

// ------------------------------------------------------------- Cobertura
function CoverageForm({ camera }: { camera: Camera }) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const update = useUpdateCamera(camera.project_id);

  /** Vista previa inmediata en el plano (solo caché) y guardado al soltar. */
  const preview = (patch: Partial<Camera>) =>
    qc.setQueryData<Camera[]>(qk.cameras(camera.project_id), (old) => old?.map((c) => (c.id === camera.id ? { ...c, ...patch } : c)));
  const commit = (patch: Partial<Camera>) => update.mutate({ id: camera.id, ...patch });

  const slider = (key: 'rotation_deg' | 'fov_deg' | 'range_m', label: string, min: number, max: number, unit: string) => (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums">{Math.round(camera[key])} {unit}</span>
      </div>
      <input
        type="range"
        className="w-full accent-accent"
        min={min}
        max={max}
        value={camera[key]}
        disabled={!canEdit}
        onChange={(e) => preview({ [key]: Number(e.target.value) })}
        onPointerUp={(e) => commit({ [key]: Number((e.target as HTMLInputElement).value) })}
        onKeyUp={(e) => commit({ [key]: Number((e.target as HTMLInputElement).value) })}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {slider('rotation_deg', 'Orientación (0° = derecha, sentido horario)', 0, 359, '°')}
      {slider('fov_deg', 'Ángulo de visión', 5, 360, '°')}
      {slider('range_m', 'Alcance', 1, 150, 'm')}
      <p className="text-xs text-muted">
        También puedes arrastrar la cámara en el plano y girarla con el tirador blanco. Posición: {(camera.pos_x * 100).toFixed(1)}% ·{' '}
        {(camera.pos_y * 100).toFixed(1)}%
      </p>
      <ErrorText error={update.error} />
    </div>
  );
}

// -------------------------------------------------------------- Adjuntos
function AttachmentsTab({ camera }: { camera: Camera }) {
  const { canEdit } = useAuth();
  const { data: attachments, isLoading } = useAttachments(camera.id);
  const upload = useUploadAttachments(camera.id, camera.project_id);
  const remove = useDeleteAttachment(camera.id);
  const photos = attachments?.filter((a) => a.kind === 'foto') ?? [];
  const docs = attachments?.filter((a) => a.kind === 'documento') ?? [];

  const onFiles = (files: FileList | null) => files?.length && upload.mutate([...files]);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex gap-2">
          <label className="btn-primary flex-1 cursor-pointer">
            <Upload className="size-4" /> Subir ficheros
            <input type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" onChange={(e) => onFiles(e.target.files)} />
          </label>
          {/* En móvil abre directamente la cámara trasera */}
          <label className="btn-ghost cursor-pointer border border-line">
            <CameraIcon className="size-4" /> Foto
            <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => onFiles(e.target.files)} />
          </label>
        </div>
      )}
      {upload.isPending && <p className="text-sm text-muted">Subiendo…</p>}
      <ErrorText error={upload.error ?? remove.error} />
      {isLoading && <p className="text-sm text-muted">Cargando…</p>}

      <section>
        <h3 className="mb-2 text-xs font-medium text-muted">Fotografías ({photos.length})</h3>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((a) => (
            <PhotoThumb key={a.id} att={a} canDelete={canEdit} onDelete={() => confirm('¿Eliminar la foto?') && remove.mutate(a.id)} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium text-muted">Documentación ({docs.length})</h3>
        <ul className="space-y-1">
          {docs.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded bg-surface-2 px-2 py-1.5 text-sm">
              <FileText className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate" title={a.original_name}>{a.original_name}</span>
              <span className="text-xs text-muted">{formatSize(a.size_bytes)}</span>
              <button className="btn-ghost px-1" onClick={() => downloadFile(`/attachments/${a.id}/file`, a.original_name)} aria-label="Descargar">
                <Download className="size-4" />
              </button>
              {canEdit && (
                <button className="btn-ghost px-1" onClick={() => confirm('¿Eliminar el documento?') && remove.mutate(a.id)} aria-label="Eliminar">
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PhotoThumb({ att, canDelete, onDelete }: { att: Attachment; canDelete: boolean; onDelete: () => void }) {
  const url = useAuthedObjectUrl(`/attachments/${att.id}/file`);
  return (
    <div className="group relative aspect-square overflow-hidden rounded bg-surface-2">
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={att.original_name} className="h-full w-full object-cover" />
        </a>
      )}
      {canDelete && (
        <button
          className="absolute top-1 right-1 rounded bg-black/70 p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={onDelete}
          aria-label="Eliminar foto"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

const formatSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);

// ------------------------------------------------------------- Historial


function HistoryTab({ cameraId }: { cameraId: string }) {
  const { data, isLoading } = useCameraHistory(cameraId);
  if (isLoading) return <p className="text-sm text-muted">Cargando…</p>;
  if (!data?.length) return <p className="text-sm text-muted">Sin cambios registrados.</p>;
  return (
    <ol className="space-y-3">
      {data.map((h) => (
        <li key={h.id} className="border-l-2 border-line pl-3 text-sm">
          <div className="flex justify-between text-xs text-muted">
            <span>{AUDIT_ACTION_LABEL[h.action]} · {h.entity_type === 'attachment' ? 'adjunto' : 'cámara'}</span>
            <time>{new Date(h.occurred_at).toLocaleString('es-ES')}</time>
          </div>
          <div className="text-ink-2">{h.user_name ?? 'Sistema'}</div>
          {h.action === 'update' && h.changes && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {Object.entries(h.changes as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => (
                <li key={k}>
                  <span className="text-muted">{k}:</span> {fmt(v.from)} → <span className="text-ink">{fmt(v.to)}</span>
                </li>
              ))}
            </ul>
          )}
          {h.entity_type === 'attachment' && h.changes && (
            <div className="text-xs text-muted">{String((h.changes as { original_name?: string }).original_name ?? '')}</div>
          )}
        </li>
      ))}
    </ol>
  );
}

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v));
