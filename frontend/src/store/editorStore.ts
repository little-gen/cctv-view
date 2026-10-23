import { create } from 'zustand';
import type { CameraStatus, CameraType } from '@/types';

export type CoverageMode = 'none' | 'heatmap' | 'gaps';

export interface CameraFilters {
  q: string;
  statuses: CameraStatus[];
  types: CameraType[];
  brands: string[];
}

interface EditorState {
  selectedId: string | null;
  /** Petición de centrar el plano en una cámara (nonce para repetir) */
  focus: { id: string; nonce: number } | null;
  /** Tipo pendiente de colocar con un toque (alternativa táctil al arrastrar) */
  placingType: CameraType | null;
  filters: CameraFilters;
  showCones: boolean;
  showLabels: boolean;
  coverageMode: CoverageMode;
  coverageOnlyOperational: boolean;
  sidebarOpen: boolean;
  /** Pestaña del panel lateral */
  sidebarTab: 'camaras' | 'topologia';
  /** NVR resaltado en el plano (id o NO_NVR); el nonce repite el encuadre */
  nvrHighlight: { id: string; nonce: number } | null;
  /** Mostrar solo las cámaras del NVR resaltado */
  nvrOnly: boolean;

  select: (id: string | null) => void;
  /** Centra, hace zoom y resalta una cámara; `select` abre además su ficha */
  focusCamera: (id: string, select?: boolean) => void;
  clearFocus: () => void;
  setPlacingType: (t: CameraType | null) => void;
  setFilters: (f: Partial<CameraFilters>) => void;
  resetFilters: () => void;
  toggle: (key: 'showCones' | 'showLabels' | 'coverageOnlyOperational' | 'sidebarOpen') => void;
  setCoverageMode: (m: CoverageMode) => void;
  setSidebarTab: (t: EditorState['sidebarTab']) => void;
  /** Resalta las cámaras de un NVR (null lo quita) y encuadra el plano en ellas */
  highlightNvr: (id: string | null) => void;
  setNvrOnly: (v: boolean) => void;
}

const EMPTY_FILTERS: CameraFilters = { q: '', statuses: [], types: [], brands: [] };

export const useEditor = create<EditorState>((set) => ({
  selectedId: null,
  focus: null,
  placingType: null,
  filters: EMPTY_FILTERS,
  showCones: true,
  showLabels: true,
  coverageMode: 'none',
  coverageOnlyOperational: true,
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  sidebarTab: 'camaras',
  nvrHighlight: null,
  nvrOnly: false,

  select: (id) => set({ selectedId: id }),
  focusCamera: (id, select = true) =>
    set({ ...(select ? { selectedId: id } : {}), focus: { id, nonce: Date.now() } }),
  clearFocus: () => set({ focus: null }),
  setPlacingType: (placingType) => set({ placingType }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<EditorState>),
  setCoverageMode: (coverageMode) => set({ coverageMode }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  highlightNvr: (id) => set(id ? { nvrHighlight: { id, nonce: Date.now() } } : { nvrHighlight: null, nvrOnly: false }),
  setNvrOnly: (nvrOnly) => set({ nvrOnly }),
}));

/** Alterna un valor dentro de un array (para chips de filtro). */
export const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
