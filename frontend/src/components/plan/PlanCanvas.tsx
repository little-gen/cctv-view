import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { Group, Image as KImage, Layer, Stage } from 'react-konva';
import { usePlanPreview, usePlanTiles } from '@/api/hooks';
import { renderCoverage, type CoverageGrid } from '@/lib/coverage';
import { useDebouncedValue, useElementSize } from '@/lib/hooks';
import { chooseLevel, tileStore, visibleTiles, type TileRef } from '@/lib/tiles';
import { useEditor } from '@/store/editorStore';
import type { Camera, CameraInput, CameraType, FloorPlan } from '@/types';
import { CameraMarker } from './CameraMarker';
import { CoverageCones } from './CoverageCones';
import { ScaleBar } from './ScaleBar';

Konva.hitOnDragEnabled = true; // necesario para el pellizco (pinch-zoom) en táctil

export const DND_MIME = 'application/x-camera-type';

interface Props {
  plan: FloorPlan;
  cameras: Camera[];
  coverage: CoverageGrid | null;
  editable: boolean;
  /** Cámaras del NVR resaltado (null = sin resaltado) */
  nvrGroup: Set<string> | null;
  onCreate: (type: CameraType, pos: { pos_x: number; pos_y: number }) => void;
  onUpdate: (id: string, patch: CameraInput) => void;
}

type Draft = Partial<Pick<Camera, 'pos_x' | 'pos_y' | 'rotation_deg'>>;
type View = { scale: number; x: number; y: number };

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;

export function PlanCanvas({ plan, cameras, coverage, editable, nvrGroup, onCreate, onUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(containerRef);

  // Plano por teselas: vista previa (≤2048 px) al instante + teselas visibles al nivel del zoom.
  // Nunca se carga ni se dibuja la imagen original completa.
  const tiles = usePlanTiles(plan.id, plan.version, !!plan.storage_key);
  const info = tiles.data;
  const preview = usePlanPreview(plan.id, info?.version);

  const { selectedId, select, focus, clearFocus, placingType, setPlacingType, showCones, showLabels, coverageMode, nvrHighlight } = useEditor();
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  // Estado transitorio mientras se arrastra/rota (se confirma al soltar)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const imgW = info?.width ?? plan.width_px ?? 1;
  const imgH = info?.height ?? plan.height_px ?? 1;
  const pxPerM = imgW / plan.width_m;

  // ----------------------------------------------------------- vista
  // Rueda, pellizco y arrastre generan decenas de eventos por segundo: se acumulan y se
  // aplican una sola vez por fotograma (requestAnimationFrame), no un render por evento.
  const viewRef = useRef(view);
  viewRef.current = view;
  const pendingView = useRef<View | null>(null);
  const rafId = useRef(0);
  const scheduleView = useCallback((update: (v: View) => View) => {
    pendingView.current = update(pendingView.current ?? viewRef.current);
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      const next = pendingView.current;
      pendingView.current = null;
      if (next) setView(next);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

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

  const zoomAt = useCallback(
    (point: { x: number; y: number }, factor: number) =>
      scheduleView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const mx = (point.x - v.x) / v.scale;
        const my = (point.y - v.y) / v.scale;
        return { scale, x: point.x - mx * scale, y: point.y - my * scale };
      }),
    [scheduleView],
  );

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

  // Encuadrar las cámaras del NVR resaltado (una vez por petición)
  const nvrFitted = useRef(0);
  useEffect(() => {
    if (!nvrHighlight || !nvrGroup || nvrFitted.current === nvrHighlight.nonce) return;
    if (!size.width || !size.height || fittedFor.current !== `${plan.id}:${plan.version}`) return;
    nvrFitted.current = nvrHighlight.nonce;
    const group = cameras.filter((c) => nvrGroup.has(c.id));
    if (!group.length) return;
    const xs = group.map((c) => c.pos_x * imgW);
    const ys = group.map((c) => c.pos_y * imgH);
    // Margen: un 15 % del grupo y al menos 12 m, para ver también lo que rodea a las cámaras
    const pad = Math.max(0.15 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), 12 * pxPerM);
    const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
    const fitScale = Math.min(size.width / imgW, size.height / imgH) * 0.95;
    const scale = Math.min(MAX_SCALE, Math.max(fitScale, Math.min(size.width / (x1 - x0), size.height / (y1 - y0))));
    setView({ scale, x: size.width / 2 - ((x0 + x1) / 2) * scale, y: size.height / 2 - ((y0 + y1) / 2) * scale });
  }, [nvrHighlight, nvrGroup, cameras, size.width, size.height, plan.id, plan.version, imgW, imgH, pxPerM]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 4500);
    return () => clearTimeout(t);
  }, [highlight]);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    // Zoom proporcional al desplazamiento: suave con touchpad, ~15 % por "clic" de rueda
    const delta = e.evt.deltaMode === 1 ? e.evt.deltaY * 40 : e.evt.deltaY;
    zoomAt(pointer, Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0014));
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
    scheduleView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (v.scale * dist) / last.dist));
      const mx = (last.center.x - v.x) / v.scale;
      const my = (last.center.y - v.y) / v.scale;
      return { scale, x: center.x - mx * scale, y: center.y - my * scale };
    });
  };

  const onStageDrag = (e: KonvaEventObject<globalThis.DragEvent>) => {
    const stage = e.target;
    if (stage === stage.getStage()) scheduleView((v) => ({ ...v, x: stage.x(), y: stage.y() }));
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
    // Clic en zona vacía (el plano no recibe eventos): deseleccionar
    if (e.target === stage) select(null);
  };

  // ------------------------------------------- arrastre/rotación
  // Callbacks estables: con React.memo, mover el plano no re-renderiza cada cámara
  const committed = useRef(new Set<string>());
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const patchDraft = useCallback((id: string, d: Draft, final: boolean) => {
    setDrafts((s) => ({ ...s, [id]: { ...s[id], ...d } }));
    if (final) {
      committed.current.add(id);
      onUpdateRef.current(id, d);
    }
  }, []);
  const onMarkerRotate = useCallback(
    (id: string, deg: number, final: boolean) => patchDraft(id, { rotation_deg: deg }, final),
    [patchDraft],
  );
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
  const coneSplit = useMemo(
    () => ({ in: shown.filter((c) => nvrGroup?.has(c.id)), out: shown.filter((c) => !nvrGroup?.has(c.id)) }),
    [shown, nvrGroup],
  );

  // ------------------------------------------------- teselas visibles
  // Nivel y área se calculan con la vista "asentada" (120 ms sin cambios) para no descargar
  // niveles intermedios durante el zoom; mientras tanto se pinta lo que ya está cargado.
  useSyncExternalStore(tileStore.subscribe, tileStore.getVersion);
  const settled = useDebouncedValue(view, 120);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const { wanted, fallback } = useMemo(() => {
    const none = { wanted: [] as TileRef[], fallback: [] as TileRef[] };
    if (!info || !size.width) return none;
    const level = chooseLevel(info, settled.scale, dpr);
    if (level === null) return none; // basta con la vista previa
    const margin = 256 / settled.scale; // precarga un borde alrededor de la vista
    const rect = {
      x0: -settled.x / settled.scale - margin,
      y0: -settled.y / settled.scale - margin,
      x1: (size.width - settled.x) / settled.scale + margin,
      y1: (size.height - settled.y) / settled.scale + margin,
    };
    return {
      wanted: visibleTiles(plan.id, info, level, rect),
      // Nivel anterior, si ya está en caché: evita ver la vista previa borrosa al acercar
      fallback: level > 0 ? visibleTiles(plan.id, info, level - 1, rect) : [],
    };
  }, [info, plan.id, settled, size.width, size.height, dpr]);
  useEffect(() => tileStore.request(wanted), [wanted]);
  const tilePad = 0.75 / view.scale; // solapa ~1 px de pantalla: sin líneas entre teselas
  const drawTiles = [...fallback, ...wanted]
    .map((t) => ({ t, bmp: tileStore.get(t.key) }))
    .filter((d): d is { t: TileRef; bmp: ImageBitmap } => !!d.bmp);

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
          onDragMove={onStageDrag}
          onDragEnd={onStageDrag}
          onClick={onStageClick}
          onTap={onStageClick}
        >
          {/* Plano: sin eventos ni hit-graph, no tiene coste al mover el ratón */}
          <Layer listening={false}>
            {preview && <KImage image={preview} width={imgW} height={imgH} />}
            {drawTiles.map(({ t, bmp }) => (
              <KImage key={t.key} image={bmp} x={t.x} y={t.y} width={t.w + tilePad} height={t.h + tilePad} />
            ))}
            {coverageCanvas && coverage && (
              <KImage image={coverageCanvas} width={coverage.cols * coverage.cellPx} height={coverage.rows * coverage.cellPx} />
            )}
          </Layer>
          <Layer listening={false}>
            {showCones && !nvrGroup && (
              <CoverageCones cameras={shown} selectedId={selectedId} imgW={imgW} imgH={imgH} pxPerM={pxPerM} view={view} viewport={size} />
            )}
            {/* Con un NVR resaltado, los conos del resto se atenúan */}
            {showCones && nvrGroup && (
              <>
                <Group opacity={0.2}>
                  <CoverageCones cameras={coneSplit.out} selectedId={selectedId} imgW={imgW} imgH={imgH} pxPerM={pxPerM} view={view} viewport={size} />
                </Group>
                <CoverageCones cameras={coneSplit.in} selectedId={selectedId} imgW={imgW} imgH={imgH} pxPerM={pxPerM} view={view} viewport={size} />
              </>
            )}
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
                  nvrMark={nvrGroup ? (nvrGroup.has(c.id) ? 'in' : 'out') : undefined}
                  onSelect={select}
                  onMove={patchDraft}
                  onRotate={onMarkerRotate}
                />
              ))}
          </Layer>
        </Stage>
      )}

      {plan.storage_key && !preview && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center text-muted">
          {tiles.isError ? (
            <span className="text-red-300">No se pudo cargar el plano: {(tiles.error as Error).message}</span>
          ) : tiles.isFetching ? (
            <span>
              Preparando el plano…
              <br />
              <span className="text-xs">Los planos grandes se procesan una sola vez para que el zoom sea fluido.</span>
            </span>
          ) : (
            'Cargando plano…'
          )}
        </div>
      )}

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
