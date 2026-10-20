/**
 * Construye `SET col1 = $n, col2 = $n+1 ...` a partir de un objeto ya validado.
 * Las claves provienen de esquemas Zod (lista blanca), nunca del cliente directamente.
 */
export function buildUpdate(data: Record<string, unknown>, startIndex = 1, extra: Record<string, unknown> = {}) {
  const entries = Object.entries({ ...data, ...extra }).filter(([, v]) => v !== undefined);
  const sets = entries.map(([k], i) => `${k} = $${startIndex + i}`);
  return { sql: sets.join(', '), values: entries.map(([, v]) => v), count: entries.length };
}

/** Normaliza un ángulo a [0, 360). */
export const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360;
