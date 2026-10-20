import type { CameraFilters } from '@/store/editorStore';
import type { Camera } from '@/types';

export function filterCameras(cameras: Camera[], f: CameraFilters): Camera[] {
  const q = f.q.trim().toLowerCase();
  return cameras.filter(
    (c) =>
      (!f.statuses.length || f.statuses.includes(c.status)) &&
      (!f.types.length || f.types.includes(c.type)) &&
      (!f.brands.length || f.brands.includes(c.brand ?? '')) &&
      (!q ||
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.ip_address ?? '').includes(q)),
  );
}

export const hasActiveFilters = (f: CameraFilters) => !!(f.q || f.statuses.length || f.types.length || f.brands.length);

export const uniqueBrands = (cameras: Camera[]) =>
  [...new Set(cameras.map((c) => c.brand).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b));
