/**
 * Rasteriza la primera página de un PDF a PNG en el navegador, para subirlo como plano.
 * pdf.js se carga bajo demanda para no penalizar la carga inicial.
 */
export async function pdfToPng(file: File, targetWidth = 4000): Promise<File> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  // Límite de seguridad: muchos navegadores móviles no admiten canvas > 16 Mpx
  const scale = Math.min(targetWidth / base.width, Math.sqrt(16_000_000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo convertir el PDF'))), 'image/png'),
  );
  return new File([blob], file.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' });
}
