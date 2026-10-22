/**
 * Rasteriza la primera página de un PDF a PNG en el navegador, para subirlo como plano.
 * pdf.js se carga bajo demanda para no penalizar la carga inicial.
 *
 * Resolución: lo máximo que admita el navegador. El servidor trocea el plano en teselas,
 * así que un plano grande ya no penaliza la visualización. Se prueba con 64 Mpx (≈ A0 a
 * 200 ppp) y se baja a 32 / 16 Mpx si el navegador no admite un canvas tan grande
 * (Safari en iOS se queda en ~16 Mpx).
 */
const PIXEL_BUDGETS = [64_000_000, 32_000_000, 16_000_000];
const MAX_SIDE = 16_384; // lado máximo de canvas en la mayoría de navegadores

export async function pdfToPng(file: File): Promise<File> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 }); // 1 unidad = 1/72"
  try {
    for (const budget of PIXEL_BUDGETS) {
      const scale = Math.min(Math.sqrt(budget / (base.width * base.height)), MAX_SIDE / Math.max(base.width, base.height));
      const blob = await renderPage(page, scale).catch(() => null);
      if (blob) return new File([blob], file.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' });
    }
    throw new Error('El navegador no ha podido convertir el PDF. Conviértelo a PNG o JPG y súbelo de nuevo.');
  } finally {
    page.cleanup();
    await pdf.destroy();
  }
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof import('pdfjs-dist')['getDocument']>['promise']>['getPage']>>;

async function renderPage(page: PdfPage, scale: number): Promise<Blob | null> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null; // canvas demasiado grande para este navegador
  try {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    // toBlob devuelve null si el canvas supera el límite del navegador
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    // Libera la memoria del canvas de inmediato (puede ser de cientos de MB)
    canvas.width = 0;
    canvas.height = 0;
  }
}
