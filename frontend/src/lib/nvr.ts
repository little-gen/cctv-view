import type { Camera, Nvr } from '@/types';

/** Umbral a partir del cual se avisa de que el NVR se está llenando. */
export const NVR_WARN_RATIO = 0.8;

/** Valor de "NVR resaltado" para las cámaras sin NVR. */
export const NO_NVR = '__none__';

export type NvrLevel = 'undefined' | 'available' | 'warning' | 'full' | 'over';

export interface NvrUsage {
  used: number;
  total: number | null;
  free: number | null;
  /** 0..1 (puede pasar de 1 en NVR antiguos con más cámaras que canales) */
  ratio: number | null;
  level: NvrLevel;
}

export function nvrUsage(nvr: Pick<Nvr, 'channels'>, used: number): NvrUsage {
  const total = nvr.channels;
  if (!total) return { used, total: null, free: null, ratio: null, level: 'undefined' };
  const ratio = used / total;
  const level: NvrLevel = used > total ? 'over' : used === total ? 'full' : ratio >= NVR_WARN_RATIO ? 'warning' : 'available';
  return { used, total, free: Math.max(0, total - used), ratio, level };
}

export const NVR_LEVEL: Record<NvrLevel, { label: string; color: string; text: string }> = {
  undefined: { label: 'Capacidad sin definir', color: '#898781', text: 'text-muted' },
  available: { label: 'Disponible', color: '#0ca30c', text: 'text-green-400' },
  warning: { label: 'Casi completo', color: '#fab219', text: 'text-amber-300' },
  full: { label: 'Completo', color: '#d03b3b', text: 'text-red-300' },
  over: { label: 'Sobrecapacidad', color: '#d03b3b', text: 'text-red-300' },
};

/** Cámaras de cada NVR (y las que no tienen, en NO_NVR), ordenadas por canal. */
export function groupByNvr(cameras: Camera[]) {
  const map = new Map<string, Camera[]>();
  for (const c of cameras) {
    const k = c.nvr_id ?? NO_NVR;
    const list = map.get(k);
    if (list) list.push(c);
    else map.set(k, [c]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.channel ?? Infinity) - (b.channel ?? Infinity) || a.code.localeCompare(b.code));
  }
  return map;
}

/** ¿La cámara pertenece al grupo resaltado (id de NVR o NO_NVR)? */
export const inNvrGroup = (c: Camera, group: string) => (group === NO_NVR ? !c.nvr_id : c.nvr_id === group);

export const channelLabel = (ch: number | null | undefined) => (ch ? `CH ${String(ch).padStart(2, '0')}` : 'CH —');
