import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef } from 'react';
import { Circle, Group, Label, Line, Rect, RegularPolygon, Tag, Text, Wedge } from 'react-konva';
import { CAMERA_STATUS, CAMERA_TYPES } from '@/lib/cameraTypes';
import type { Camera } from '@/types';

const HANDLE_DIST = 38; // px de pantalla

/** Sector de cobertura en coordenadas de imagen. 0° = derecha, sentido horario. */
export function CoverageCone({ camera, imgW, imgH, pxPerM, scale, selected }: {
  camera: Camera;
  imgW: number;
  imgH: number;
  pxPerM: number;
  scale: number;
  selected: boolean;
}) {
  const color = CAMERA_TYPES[camera.type].color;
  const common = {
    x: camera.pos_x * imgW,
    y: camera.pos_y * imgH,
    radius: camera.range_m * pxPerM,
    fill: color,
    opacity: selected ? 0.32 : camera.status === 'operativa' ? 0.2 : 0.1,
    stroke: color,
    strokeWidth: 1.5 / scale,
    dash: camera.status === 'operativa' ? undefined : [6 / scale, 4 / scale],
    listening: false,
  };
  if (camera.fov_deg >= 360) return <Circle {...common} />;
  return <Wedge {...common} angle={camera.fov_deg} rotation={camera.rotation_deg - camera.fov_deg / 2} />;
}

interface MarkerProps {
  camera: Camera;
  imgW: number;
  imgH: number;
  scale: number;
  selected: boolean;
  /** Si está definido, se muestra el pulso de resaltado (cambiar el valor lo reinicia) */
  highlightKey?: number;
  editable: boolean;
  showLabel: boolean;
  onSelect: () => void;
  onMove: (pos: { pos_x: number; pos_y: number }, final: boolean) => void;
  onRotate: (deg: number, final: boolean) => void;
}

/** Anillos expansivos alrededor de la cámara encontrada por el buscador. */
function PulseRing() {
  const ring1 = useRef<Konva.Circle>(null);
  const ring2 = useRef<Konva.Circle>(null);
  useEffect(() => {
    const layer = ring1.current?.getLayer();
    if (!layer) return;
    const anim = new Konva.Animation((frame) => {
      const time = frame?.time ?? 0;
      [ring1.current, ring2.current].forEach((ring, i) => {
        const t = ((time + i * 600) % 1200) / 1200;
        ring?.radius(18 + t * 42);
        ring?.opacity(1 - t);
      });
    }, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, []);
  return (
    <>
      <Circle ref={ring1} radius={18} stroke="#ffffff" strokeWidth={3} listening={false} />
      <Circle ref={ring2} radius={18} stroke="#3987e5" strokeWidth={3} listening={false} />
      <Circle radius={22} stroke="#3987e5" strokeWidth={4} listening={false} />
    </>
  );
}

export function CameraMarker({ camera, imgW, imgH, scale, selected, highlightKey, editable, showLabel, onSelect, onMove, onRotate }: MarkerProps) {
  const t = CAMERA_TYPES[camera.type];
  const ring = CAMERA_STATUS[camera.status].color;
  const inv = 1 / scale; // tamaño constante en pantalla
  const shape = { fill: t.color, stroke: ring, strokeWidth: 3 };
  const rad = (camera.rotation_deg * Math.PI) / 180;

  const clampPos = (node: Konva.Node) => ({
    pos_x: Math.min(1, Math.max(0, node.x() / imgW)),
    pos_y: Math.min(1, Math.max(0, node.y() / imgH)),
  });

  const handleRotate = (e: KonvaEventObject<DragEvent>, final: boolean) => {
    e.cancelBubble = true;
    const node = e.target;
    const deg = Math.round((Math.atan2(node.y(), node.x()) * 180) / Math.PI);
    onRotate((deg + 360) % 360, final);
    // Mantener el tirador sobre la circunferencia
    const r = (deg * Math.PI) / 180;
    node.position({ x: Math.cos(r) * HANDLE_DIST, y: Math.sin(r) * HANDLE_DIST });
  };

  return (
    <Group
      x={camera.pos_x * imgW}
      y={camera.pos_y * imgH}
      scaleX={inv}
      scaleY={inv}
      draggable={editable}
      onClick={(e) => { e.cancelBubble = true; onSelect(); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(); }}
      onDragStart={onSelect}
      onDragMove={(e) => e.target === e.currentTarget && onMove(clampPos(e.target), false)}
      onDragEnd={(e) => e.target === e.currentTarget && onMove(clampPos(e.target), true)}
      onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = editable ? 'move' : 'pointer'; }}
      onMouseLeave={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = ''; }}
    >
      {/* Indicador de dirección */}
      {camera.fov_deg < 360 && (
        <Line points={[0, 0, Math.cos(rad) * 22, Math.sin(rad) * 22]} stroke={t.color} strokeWidth={3} lineCap="round" listening={false} />
      )}
      {highlightKey !== undefined && <PulseRing key={highlightKey} />}
      {selected && <Circle radius={18} stroke="#ffffff" strokeWidth={2} dash={[4, 3]} listening={false} />}

      {/* Área de toque más grande que el icono (móvil) */}
      <Circle radius={20} fill="transparent" />
      {t.shape === 'circle' && <Circle radius={11} {...shape} />}
      {t.shape === 'bullet' && <Rect x={-13} y={-8} width={26} height={16} cornerRadius={8} {...shape} />}
      {t.shape === 'hexagon' && <RegularPolygon sides={6} radius={12.5} {...shape} />}
      {t.shape === 'diamond' && <RegularPolygon sides={4} radius={13} {...shape} />}
      {t.shape === 'square' && <Rect x={-10.5} y={-10.5} width={21} height={21} cornerRadius={2} {...shape} />}
      <Text
        text={t.short}
        width={30}
        x={-15}
        y={t.short.length > 1 ? -4 : -5.5}
        align="center"
        fontSize={t.short.length > 1 ? 8 : 11}
        fontStyle="bold"
        fill="#ffffff"
        listening={false}
      />

      {showLabel && (
        <Label y={16} x={0} listening={false}>
          <Tag fill="rgba(13,13,13,0.8)" cornerRadius={3} pointerDirection="up" pointerWidth={6} pointerHeight={4} />
          <Text text={camera.code} fontSize={10} padding={3} fill="#f0efec" />
        </Label>
      )}

      {selected && editable && camera.fov_deg < 360 && (
        <Circle
          x={Math.cos(rad) * HANDLE_DIST}
          y={Math.sin(rad) * HANDLE_DIST}
          radius={8}
          fill="#ffffff"
          stroke={t.color}
          strokeWidth={3}
          draggable
          onDragMove={(e) => handleRotate(e, false)}
          onDragEnd={(e) => handleRotate(e, true)}
          onDragStart={(e) => { e.cancelBubble = true; }}
          onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'grab'; }}
        />
      )}
    </Group>
  );
}
