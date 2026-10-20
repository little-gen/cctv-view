import { CameraGlyph } from '@/components/cameras/CameraGlyph';
import { CAMERA_TYPE_KEYS, CAMERA_TYPES } from '@/lib/cameraTypes';
import { useEditor } from '@/store/editorStore';
import { DND_MIME } from './PlanCanvas';

/**
 * Paleta flotante de tipos de cámara.
 * Escritorio: arrastrar y soltar sobre el plano. Táctil: tocar el tipo y luego el plano.
 */
export function CameraPalette() {
  const { placingType, setPlacingType } = useEditor();
  return (
    <div className="panel absolute top-3 left-3 z-10 flex flex-col gap-0.5 p-1 shadow-lg" aria-label="Añadir cámara">
      <span className="px-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted uppercase">Añadir</span>
      {CAMERA_TYPE_KEYS.map((type) => (
        <button
          key={type}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_MIME, type);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => setPlacingType(placingType === type ? null : type)}
          className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-3 ${placingType === type ? 'bg-accent/20 ring-1 ring-accent' : ''}`}
          title={`${CAMERA_TYPES[type].label}: arrastra al plano o pulsa y toca el plano`}
        >
          <CameraGlyph type={type} size={20} />
          <span className="hidden text-ink-2 sm:inline">{CAMERA_TYPES[type].label}</span>
        </button>
      ))}
    </div>
  );
}
