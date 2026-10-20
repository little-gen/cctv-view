const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];

/** Barra de escala en metros (elige una longitud "redonda" de ~80-160 px). */
export function ScaleBar({ pxPerM }: { pxPerM: number }) {
  if (!isFinite(pxPerM) || pxPerM <= 0) return null;
  const meters = NICE.find((m) => m * pxPerM >= 80) ?? NICE[NICE.length - 1];
  const width = meters * pxPerM;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-ink-2">
      <div className="border-x-2 border-b-2 border-ink-2" style={{ width, height: 6 }} />
      <div className="mt-0.5 text-center tabular-nums">{meters} m</div>
    </div>
  );
}
