import { create } from 'zustand';
import type { CameraStatus, CameraType } from '@/types';

export interface GlobalSearchFilters {
  projectId: string | null;
  types: CameraType[];
  statuses: CameraStatus[];
  brands: string[];
  nvrId: string | null;
}

const EMPTY: GlobalSearchFilters = { projectId: null, types: [], statuses: [], brands: [], nvrId: null };

interface SearchState {
  q: string;
  filters: GlobalSearchFilters;
  open: boolean;
  setQ: (q: string) => void;
  setFilters: (f: Partial<GlobalSearchFilters>) => void;
  resetFilters: () => void;
  setOpen: (open: boolean) => void;
}

/** Estado del buscador global: se conserva al navegar para poder volver a los resultados. */
export const useSearch = create<SearchState>((set) => ({
  q: '',
  filters: EMPTY,
  open: false,
  setQ: (q) => set({ q }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: EMPTY }),
  setOpen: (open) => set({ open }),
}));

export const countFilters = (f: GlobalSearchFilters) =>
  (f.projectId ? 1 : 0) + f.types.length + f.statuses.length + f.brands.length + (f.nvrId ? 1 : 0);
