import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Image as KImage, Layer, Stage } from 'react-konva';
import { useAuthedObjectUrl } from '@/api/hooks';
import { renderCoverage, type CoverageGrid } from '@/lib/coverage';
import { useElementSize, useHtmlImage } from '@/lib/hooks';
import { useEditor } from '@/store/editorStore';
import type { Camera, CameraInput, CameraType, FloorPlan } from '@/types';
import { CameraMarker, CoverageCone } from './CameraMarker';
import { ScaleBar } from './ScaleBar';

Konva.hitOnDragEnabled = true; // necesario para el pellizco (pinch-zoom) en táctil

export const DND_MIME = 'application/x-camera-type';

interface Props {
  plan: FloorPlan;
  cameras: Camera[];
  coverage: CoverageGrid | null;
  editable: boolean;
  onCreate: (type: CameraType, pos: { pos_x: number; pos_y: number }) => void;
  onUpdate: (id: string, patch: CameraInput) => void;
}

type Draft = Partial<Pick<Camera, 'pos_x' | 'pos_y' | 'rotation_deg'>>;

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

export function PlanCanvas({ plan, cameras, coverage, editable, onCreate, onUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(containerRef);
  const imageUrl = useAuthedObjectUrl(plan.storage_key ? `/plans/${plan.id}/image?v=${plan.version}` : null);
  const image = useHtmlImage(imageUrl);

  const { selectedId, select, focus, clearFocus, placingType, setPlacingType, showCones, showLabels, coverageMode } = useEditor();
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  // Estado transitorio mientras se arrastra/rota (se confirma al soltar)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const imgW = plan.width_px ?? image?.width ?? 1;
  const imgH = plan.height_px ?? image?.height ?? 1;
  const pxPerM = imgW / plan.width_m;

  // ----------------------------------------------------------- vista
  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const scale = Math.min(size.width / imgW, size.height / imgH) * 0.95;
    setView({ scale, x: (size.width - imgW * scale) / 2, y: (size.height - imgH * scale) / 2 });
  }, [size.width, size.height, imgW, imgH]);

  // Encajar al cambiar de plano o al tener tamaño por primera vez
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${plan.id}:${plan.version}`;
    if (size.width && fittedFor.current !== key) {
      fittedFor.current = key;
      fit();
    }
  }, [plan.id, plan.version, size.width, fit]);

  const zoomAt = useCallback((point: { x: number; y: number }, factor: number) => {
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const mx = (point.x - v.x) / v.scale;
      const my = (point.y - v.y) / v.scale;
      return { scale, x: point.x - mx * scale, y: point.y - my * scale };
    });
  }, []);

  const zoomCenter = (factor: number) => zoomAt({ x: size.width / 2, y: size.height / 2 }, factor);

  // Centrar, hacer zoom y resaltar una cámara (desde la lista o el buscador global).
  // La petición queda pendiente en el store hasta que el lienzo tiene tamaño, el plano
  // está encajado y la cámara está cargada; entonces se consume (clearFocus).
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  useEffect(() => {
    if (!focus || !size.width || !size.height || fittedFor.current !== `${plan.id}:${plan.version}`) return;
    const cam = cameras.find((c) => c.id === focus.id);
    if (!cam) return;
    const fitScale = Math.min(size.width / imgW, size.height / imgH);
    // Zoom para que el alcance de la cámara ocupe ~40% de la vista (mínimo 2× el encaje)
    const reachPx = Math.max(cam.range_m, 8) * pxPerM;
    const scale = Math.min(MAX_SCALE, Math.max(fitScale * 2, Math.min(size.width, size.height) / (reachPx * 2.5)));
    setView({ scale, x: size.width / 2 - cam.pos_x * imgW * scale, y: size.height / 2 - cam.pos_y * imgH * scale });
    setHighlight({ id: cam.id, nonce: focus.nonce });
    clearFocus();
  }, [focus, size.width, size.height, cameras, plan.id, plan.version, imgW, imgH, pxPerM, clearFocus]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 4500);
    return () => clearTimeout(t);
  }, [highlight]);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (pointer) zoomAt(pointer, e.evt.deltaY > 0 ? 1 / 1.15 : 1.15);
  };

  // Pellizco en táctil
  const pinch = useRef<{ dist: number; center: { x: number; y: number } } | null>(null);
  const onTouchMove = (e: KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    const stage = stageRef.current;
    if (touches.length !== 2 || !stage) return;
    e.evt.preventDefault();
    if (stage.isDragging()) stage.stopDrag();
    const rect = stage.container().getBoundingClientRect();
    const p1 = { x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top };
    const p2 = { x: touches[1].clientX - rect.left, y: touches[1].clientY - rect.top };
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const last = pinch.current;
    pinch.current = { dist, center };
    if (!last) return;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (v.scale * dist) / last.dist));
      const mx = (last.center.x - v.x) / v.scale;
      const my = (last.center.y - v.y) / v.scale;
      return { scale, x: center.x - mx * scale, y: center.y - my * scale };
    });
  };

  // ------------------------------------------------- crear cámaras
  const toNormalized = (p: { x: number; y: number } | null) => {
    if (!p || p.x < 0 || p.y < 0 || p.x > imgW || p.y > imgH) return null;
    return { pos_x: p.x / imgW, pos_y: p.y / imgH };
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const type = e.dataTransfer.getData(DND_MIME) as CameraType;
    const stage = stageRef.current;
    if (!type || !stage || !editable) return;
    e.preventDefault();
    stage.setPointersPositions(e.nativeEvent);
    const pos = toNormalized(stage.getRelativePointerPosition());
    if (pos) onCreate(type, pos);
  };

  const onStageClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (placingType && editable) {
      const pos = toNormalized(stage.getRelativePointerPosition());
      if (pos) onCreate(placingType, pos);
      setPlacingType(null);
      return;
    }
    // Clic en zona vacía: deseleccionar
    if (e.target === stage || e.target.name() === 'plan-image') select(null);
  };

  // ------------------------------------------- arrastre/rotación
  const committed = useRef(new Set<string>());
  const patchDraft = (id: string, d: Draft, final: boolean) => {
    setDrafts((s) => ({ ...s, [id]: { ...s[id], ...d } }));
    if (final) {
      committed.current.add(id);
      onUpdate(id, d);
    }
  };
  // El borrador se descarta cuando la caché (actualización optimista) ya refleja el cambio,
  // así el marcador no "salta" a la posición anterior durante un fotograma.
  useEffect(() => {
    if (!committed.current.size) return;
    setDrafts((s) => {
      const next = { ...s };
      for (const id of committed.current) delete next[id];
      committed.current.clear();
      return next;
    });
  }, [cameras]);

  const shown = useMemo(() => cameras.map((c) => (drafts[c.id] ? { ...c, ...drafts[c.id] } : c)), [cameras, drafts]);
  const selected = shown.find((c) => c.id === selectedId);

  const coverageCanvas = useMemo(
    () => (coverage && coverageMode !== 'none' ? renderCoverage(coverage, coverageMode) : null),
    [coverage, coverageMode],
  );

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-[#121211] ${placingType ? 'cursor-crosshair' : ''}`}
      onDragOver={(e) => editable && e.dataTransfer.types.includes(DND_MIME) && e.preventDefault()}
      onDrop={onDrop}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={() => (pinch.current = null)}
          onDragEnd={(e) => e.target === e.target.getStage() && setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))}
          onClick={onStageClick}
          onTap={onStageClick}
        >
          <Layer>
            {image && <KImage image={image} width={imgW} height={imgH} name="plan-image" />}
            {coverageCanvas && coverage && (
              <KImage
                image={coverageCanvas}
                width={coverage.cols * coverage.cellPx}
                height={coverage.rows * coverage.cellPx}
                listening={false}
              />
            )}
          </Layer>
          <Layer listening={false}>
            {showCones &&
              shown.map((c) => (
                <CoverageCone key={c.id} camera={c} imgW={imgW} imgH={imgH} pxPerM={pxPerM} scale={view.scale} selected={c.id === selectedId} />
              ))}
          </Layer>
          <Layer>
            {shown
              .filter((c) => c.id !== selectedId && c.id !== highlight?.id)
              .concat(selected ? [selected] : []) // seleccionada y resaltada encima
              .concat(highlight && highlight.id !== selectedId ? shown.filter((c) => c.id === highlight.id) : [])
              .map((c) => (
                <CameraMarker
                  key={c.id}
                  camera={c}
                  imgW={imgW}
                  imgH={imgH}
                  scale={view.scale}
                  selected={c.id === selectedId}
                  highlightKey={highlight?.id === c.id ? highlight.nonce : undefined}
                  editable={editable}
                  showLabel={showLabels}
                  onSelect={() => select(c.id)}
                  onMove={(pos, final) => patchDraft(c.id, pos, final)}
                  onRotate={(deg, final) => patchDraft(c.id, { rotation_deg: deg }, final)}
                />
              ))}
          </Layer>
        </Stage>
      )}

      {!image && plan.storage_key && <div className="absolute inset-0 grid place-items-center text-muted">Cargando plano…</div>}

      {placingType && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-strong px-3 py-1 text-sm text-white shadow-lg">
          Toca el plano para colocar la cámara ·{' '}
          <button className="underline" onClick={() => setPlacingType(null)}>cancelar</button>
        </div>
      )}

      <div className="absolute right-3 bottom-3 flex flex-col gap-1">
        <button className="btn panel px-2" onClick={() => zoomCenter(1.25)} title="Acercar" aria-label="Acercar"><Plus className="size-4" /></button>
        <button className="btn panel px-2" onClick={() => zoomCenter(0.8)} title="Alejar" aria-label="Alejar"><Minus className="size-4" /></button>
        <button className="btn panel px-2" onClick={fit} title="Encajar plano" aria-label="Encajar plano"><Maximize2 className="size-4" /></button>
      </div>
      <ScaleBar pxPerM={pxPerM * view.scale} />
    </div>
  );
}
