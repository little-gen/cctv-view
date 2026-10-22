const TOKEN_KEY = 'pc_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  /** Permite cancelar la petición (React Query la cancela al seguir escribiendo) */
  signal?: AbortSignal;
}

async function request(path: string, { method = 'GET', body, form, signal }: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal,
  });
  if (res.status === 401 && token) {
    tokenStore.clear();
    window.dispatchEvent(new Event('auth:logout'));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Contraseña temporal pendiente de cambio: la app muestra la pantalla de cambio
    if (res.status === 403 && data.details?.code === 'PASSWORD_CHANGE_REQUIRED') {
      window.dispatchEvent(new Event('auth:password-change'));
    }
    throw new ApiError(res.status, data.error ?? statusMessage(res.status), data.details);
  }
  return res;
}

// Errores sin cuerpo JSON (p. ej. los genera nginx antes de llegar a la API)
const statusMessage = (status: number) =>
  status === 413
    ? 'El fichero supera el tamaño máximo que acepta el servidor'
    : status === 429
      ? 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.'
      : status === 0
        ? 'Error de red'
        : `Error ${status}`;

/**
 * Subida con progreso (fetch no informa del progreso de envío). `onProgress` recibe 0..1;
 * al llegar a 1 el servidor aún puede estar procesando (p. ej. generando las teselas del plano).
 */
export function uploadWithProgress<T>(
  method: 'POST' | 'PUT',
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.upload.onload = () => onProgress?.(1);
    xhr.onload = () => {
      let data: { error?: string; details?: unknown } | undefined;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status === 401 && token) {
        tokenStore.clear();
        window.dispatchEvent(new Event('auth:logout'));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data?.error ?? statusMessage(xhr.status), data?.details));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Error de red durante la subida'));
    xhr.send(form);
  });
}

export async function api<T>(path: string, opts?: RequestOptions): Promise<T> {
  const res = await request(path, opts);
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Descarga un recurso protegido como Blob (imágenes de planos, fotos...). */
export async function fetchBlob(path: string): Promise<Blob> {
  return (await request(path)).blob();
}

/** Descarga un fichero protegido y lo guarda con el nombre que indique el servidor. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await request(path);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
