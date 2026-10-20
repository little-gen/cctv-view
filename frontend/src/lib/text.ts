/** Normaliza igual que el servidor (search_norm): minúsculas y sin acentos. */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const tokenize = (q: string) => q.split(/\s+/).filter(Boolean).map(norm);

/**
 * Trocea `text` en segmentos marcando las coincidencias con cualquiera de los
 * tokens, ignorando mayúsculas y acentos ("almacen" resalta "Almacén").
 */
export function highlightSegments(text: string, tokens: string[]): { text: string; hit: boolean }[] {
  if (!text || !tokens.length) return [{ text, hit: false }];
  // Normalización carácter a carácter para conservar la correspondencia de índices
  const chars = [...text];
  const normChars = chars.map((c) => norm(c) || c);
  const normText = normChars.join('');
  const starts: number[] = []; // índice en normText -> índice en chars
  normChars.forEach((nc, i) => {
    for (let k = 0; k < nc.length; k++) starts.push(i);
  });

  const marked = new Array(chars.length).fill(false);
  for (const t of tokens) {
    let from = 0;
    for (let idx = normText.indexOf(t, from); idx !== -1; idx = normText.indexOf(t, from)) {
      for (let j = idx; j < idx + t.length; j++) marked[starts[j]] = true;
      from = idx + t.length;
    }
  }

  const out: { text: string; hit: boolean }[] = [];
  chars.forEach((c, i) => {
    const last = out[out.length - 1];
    if (last && last.hit === marked[i]) last.text += c;
    else out.push({ text: c, hit: marked[i] });
  });
  return out;
}

export const matches = (text: string | null | undefined, tokens: string[]) =>
  !!text && tokens.some((t) => norm(text).includes(t));

/** Fragmento de un texto largo centrado en la primera coincidencia. */
export function snippet(text: string, tokens: string[], radius = 40): string {
  const n = norm(text);
  const idx = Math.min(...tokens.map((t) => n.indexOf(t)).filter((i) => i >= 0));
  if (!isFinite(idx)) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  return (start > 0 ? '…' : '') + text.slice(start, idx + radius) + (idx + radius < text.length ? '…' : '');
}
