import type { CameraStatus, CameraType } from '@/types';

/**
 * Identidad visual de cada tipo. Con 5 tipos dispersos por el plano ningún juego de
 * colores es distinguible en todos los pares (incluido daltonismo), por eso el tipo
 * se codifica SIEMPRE con forma + etiqueta; el color es un refuerzo.
 * Colores: slots categóricos 1-5 de la paleta validada para fondo oscuro.
 */
export const CAMERA_TYPES: Record<
  CameraType,
  { label: string; short: string; color: string; shape: 'circle' | 'bullet' | 'hexagon' | 'diamond' | 'square'; defaultFov: number }
> = {
  domo: { label: 'Domo', short: 'D', color: '#3987e5', shape: 'circle', defaultFov: 100 },
  bullet: { label: 'Bullet', short: 'B', color: '#d95926', shape: 'bullet', defaultFov: 80 },
  ptz: { label: 'PTZ', short: 'PTZ', color: '#199e70', shape: 'hexagon', defaultFov: 360 },
  termica: { label: 'Térmica', short: 'T', color: '#c98500', shape: 'diamond', defaultFov: 50 },
  lpr: { label: 'LPR', short: 'LPR', color: '#d55181', shape: 'square', defaultFov: 30 },
};

export const CAMERA_TYPE_KEYS = Object.keys(CAMERA_TYPES) as CameraType[];

/** Colores de estado reservados; siempre acompañados de etiqueta. */
export const CAMERA_STATUS: Record<CameraStatus, { label: string; color: string }> = {
  operativa: { label: 'Operativa', color: '#0ca30c' },
  averiada: { label: 'Averiada', color: '#d03b3b' },
  mantenimiento: { label: 'En mantenimiento', color: '#fab219' },
};

export const CAMERA_STATUS_KEYS = Object.keys(CAMERA_STATUS) as CameraStatus[];
