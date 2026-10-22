import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { countFilters, type GlobalSearchFilters } from '@/store/searchStore';
import type { Attachment, AuditEntry, Camera, CameraInput, FloorPlan, Nvr, Project, ProjectDetail, SearchResponse, User } from '@/types';
import type { TileInfo } from '@/lib/tiles';
import { api, fetchBlob, uploadWithProgress } from './client';

export const qk = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  cameras: (projectId: string) => ['cameras', projectId] as const,
  nvrs: (projectId: string) => ['nvrs', projectId] as const,
  attachments: (cameraId: string) => ['attachments', cameraId] as const,
  history: (cameraId: string) => ['history', cameraId] as const,
  users: ['users'] as const,
  audit: ['audit'] as const,
  search: ['search'] as const,
};

// ------------------------------------------------------------- Proyectos
export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: () => api<Project[]>('/projects') });

export const useProject = (id: string) =>
  useQuery({ queryKey: qk.project(id), queryFn: () => api<ProjectDetail>(`/projects/${id}`) });

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Pick<Project, 'name' | 'client' | 'address' | 'description'>) =>
      api<Project>('/projects', { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

// ---------------------------------------------------------------- Planos
export function useCreatePlan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; width_m?: number }) =>
      api<FloorPlan>(`/projects/${projectId}/plans`, { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  });
}

export function useUpdatePlan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; width_m?: number }) =>
      api<FloorPlan>(`/plans/${id}`, { method: 'PATCH', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  });
}

export function useUploadPlanImage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, file, onProgress }: { planId: string; file: File; onProgress?: (fraction: number) => void }) => {
      const form = new FormData();
      form.append('file', file);
      return uploadWithProgress<FloorPlan & { warning?: string }>('PUT', `/plans/${planId}/image`, form, onProgress);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.project(projectId) }),
  });
}

/**
 * Metadatos de la pirámide de teselas. La primera vez que se abre un plano subido antes
 * de existir las teselas, el servidor las genera (puede tardar unos segundos).
 */
export const usePlanTiles = (planId: string, version: number, enabled: boolean) =>
  useQuery({
    queryKey: ['plan-tiles', planId, version],
    queryFn: () => api<TileInfo>(`/plans/${planId}/tiles-info`),
    enabled,
    staleTime: Infinity,
    retry: 2,
  });

/** Vista previa del plano (≤2048 px) descodificada fuera del hilo principal. */
export function usePlanPreview(planId: string, version: number | undefined) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    let bmp: ImageBitmap | null = null;
    fetchBlob(`/plans/${planId}/preview/${version}`)
      .then((blob) => createImageBitmap(blob))
      .then((b) => {
        bmp = b;
        if (cancelled) b.close();
        else setBitmap(b);
      })
      .catch(() => !cancelled && setBitmap(null));
    return () => {
      cancelled = true;
      bmp?.close();
      setBitmap(null);
    };
  }, [planId, version]);
  return bitmap;
}

// --------------------------------------------------------------- Cámaras
export const useCameras = (projectId: string) =>
  useQuery({ queryKey: qk.cameras(projectId), queryFn: () => api<Camera[]>(`/projects/${projectId}/cameras`) });

export function useCreateCamera(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CameraInput) => api<Camera>(`/projects/${projectId}/cameras`, { method: 'POST', body: data }),
    onSuccess: (cam) => {
      qc.setQueryData<Camera[]>(qk.cameras(projectId), (old) => [...(old ?? []), cam]);
      qc.invalidateQueries({ queryKey: qk.search });
    },
  });
}

/** Actualización optimista: el marcador se mueve/rota al instante en el plano. */
export function useUpdateCamera(projectId: string) {
  const qc = useQueryClient();
  const key = qk.cameras(projectId);
  return useMutation({
    mutationFn: ({ id, ...data }: CameraInput & { id: string }) =>
      api<Camera>(`/cameras/${id}`, { method: 'PATCH', body: data }),
    onMutate: async ({ id, ...data }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Camera[]>(key);
      qc.setQueryData<Camera[]>(key, (old) => old?.map((c) => (c.id === id ? { ...c, ...data } : c)));
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(key, ctx.previous),
    onSuccess: (cam) => {
      qc.setQueryData<Camera[]>(key, (old) => old?.map((c) => (c.id === cam.id ? cam : c)));
      qc.invalidateQueries({ queryKey: qk.history(cam.id) });
      qc.invalidateQueries({ queryKey: qk.search });
    },
  });
}

export function useDeleteCamera(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/cameras/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<Camera[]>(qk.cameras(projectId), (old) => old?.filter((c) => c.id !== id));
      qc.invalidateQueries({ queryKey: qk.search });
    },
  });
}

export const useCameraHistory = (cameraId: string) =>
  useQuery({ queryKey: qk.history(cameraId), queryFn: () => api<AuditEntry[]>(`/cameras/${cameraId}/history`) });

// ------------------------------------------------------------------- NVR
export const useNvrs = (projectId: string) =>
  useQuery({ queryKey: qk.nvrs(projectId), queryFn: () => api<Nvr[]>(`/projects/${projectId}/nvrs`) });

export function useCreateNvr(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Nvr>) => api<Nvr>(`/projects/${projectId}/nvrs`, { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.nvrs(projectId) }),
  });
}

export function useDeleteNvr(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/nvrs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.nvrs(projectId) });
      qc.invalidateQueries({ queryKey: qk.cameras(projectId) });
    },
  });
}

// -------------------------------------------------------------- Adjuntos
export const useAttachments = (cameraId: string) =>
  useQuery({ queryKey: qk.attachments(cameraId), queryFn: () => api<Attachment[]>(`/cameras/${cameraId}/attachments`) });

export function useUploadAttachments(cameraId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      return api<Attachment[]>(`/cameras/${cameraId}/attachments`, { method: 'POST', form });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.attachments(cameraId) });
      qc.invalidateQueries({ queryKey: qk.cameras(projectId) });
    },
  });
}

export function useDeleteAttachment(cameraId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.attachments(cameraId) }),
  });
}

// -------------------------------------------------------- Usuarios / audit
export const useUsers = () => useQuery({ queryKey: qk.users, queryFn: () => api<User[]>('/users') });

/**
 * Cuentas bloqueadas por intentos fallidos (aviso para el administrador en la cabecera).
 * Comparte la caché de useUsers y se refresca cada minuto; solo se activa para administradores.
 */
export function useLockedUsers(enabled: boolean) {
  const { data } = useQuery({
    queryKey: qk.users,
    queryFn: () => api<User[]>('/users'),
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  return (data ?? []).filter((u) => u.locked_until && new Date(u.locked_until) > new Date());
}

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<User> & { password?: string }) =>
      id ? api<User>(`/users/${id}`, { method: 'PATCH', body: data }) : api<User>('/users', { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}

/** Genera un enlace de un solo uso para que el usuario elija contraseña (se muestra una vez). */
export function useResetUserAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ url: string; email: string; expiresAt: string }>(`/users/${id}/reset-access`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}

export function useUnlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<User>(`/users/${id}/unlock`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}

// ----------------------------------------------------- Búsqueda global
export function useGlobalSearch(q: string, f: GlobalSearchFilters) {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (f.projectId) params.set('projectId', f.projectId);
  if (f.types.length) params.set('type', f.types.join(','));
  if (f.statuses.length) params.set('status', f.statuses.join(','));
  if (f.brands.length) params.set('brand', f.brands.join(','));
  if (f.nvrId) params.set('nvrId', f.nvrId);
  const qs = params.toString();
  return useQuery({
    queryKey: [...qk.search, qs],
    queryFn: ({ signal }) => api<SearchResponse>(`/search?${qs}`, { signal }),
    // A partir de 2 caracteres, o con algún filtro activo
    enabled: q.trim().length >= 2 || countFilters(f) > 0,
    placeholderData: keepPreviousData, // sin parpadeo mientras se escribe
    staleTime: 15_000,
  });
}

export const useAudit = () => useQuery({ queryKey: qk.audit, queryFn: () => api<AuditEntry[]>('/audit?limit=200') });

// ------------------------------------------------- Ficheros protegidos
/** Convierte un recurso protegido por JWT en una URL `blob:` utilizable en <img> o Konva. */
export function useAuthedObjectUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return setUrl(null);
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchBlob(path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url;
}
