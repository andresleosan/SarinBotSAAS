export const MAX_RECEIPT_BYTES = 150 * 1024;

export async function compressReceiptToWebP(file: File, maxWidth = 1400, quality = 0.82): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Selecciona una imagen JPG, PNG o WebP.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('La imagen debe pesar menos de 20 MB.');
  if (!Number.isFinite(maxWidth) || maxWidth < 128 || maxWidth > 4096 || !Number.isFinite(quality) || quality <= 0 || quality > 1) throw new Error('Configuración de compresión no válida.');
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.width || !img.height || img.width * img.height > 50_000_000) { reject(new Error('La resolución de la imagen es demasiado grande.')); return; }
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };

    img.src = url;
  });
  const canvas = document.createElement('canvas');
  let width = Math.min(maxWidth, img.width); let currentQuality = quality;
  for (let attempt = 0; attempt < 12; attempt++) {
    canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(img.height * canvas.width / img.width));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo inicializar Canvas 2D.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('No se pudo comprimir la imagen.')), 'image/webp', currentQuality));
    if (blob.type !== 'image/webp') throw new Error('Tu navegador no soporta compresión WebP.');
    if (blob.size <= MAX_RECEIPT_BYTES) return blob;
    currentQuality = Math.max(0.4, currentQuality - 0.1); width *= 0.85;
  }
  throw new Error('La imagen no pudo reducirse a 150 KB. Recorta la factura e inténtalo de nuevo.');
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer la imagen.'));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(blob);
  });
}
