import { CAMERA_STATUS, CAMERA_TYPES } from '@/lib/cameraTypes';
import type { CameraStatus, CameraType } from '@/types';

/** Versión SVG del marcador del plano (misma forma y color) para listas y paleta. */
export function CameraGlyph({ type, status, size = 22 }: { type: CameraType; status?: CameraStatus; size?: number }) {
  const t = CAMERA_TYPES[type];
  const stroke = status ? CAMERA_STATUS[status].color : '#f0efec';
  const common = { fill: t.color, stroke, strokeWidth: 2.5 };
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-label={t.label} role="img" className="shrink-0">
      {t.shape === 'circle' && <circle r={9} {...common} />}
      {t.shape === 'bullet' && <rect x={-10} y={-6.5} width={20} height={13} rx={6.5} {...common} />}
      {t.shape === 'hexagon' && <polygon points="0,-10 8.7,-5 8.7,5 0,10 -8.7,5 -8.7,-5" {...common} />}
      {t.shape === 'diamond' && <polygon points="0,-10.5 10.5,0 0,10.5 -10.5,0" {...common} />}
      {t.shape === 'square' && <rect x={-8.5} y={-8.5} width={17} height={17} rx={2} {...common} />}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontSize={t.short.length > 1 ? 6 : 9}
        fontWeight={700}
        fontFamily="system-ui, sans-serif"
      >
        {t.short}
      </text>
    </svg>
  );
}

export function StatusBadge({ status }: { status: CameraStatus }) {
  const s = CAMERA_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}
