'use client';

/**
 * Phone photos are often larger than the 4.5 MB request limit of Vercel Functions. Images are scaled to
 * at most 2000 px on the long side and re-encoded as JPEG before upload; a signed note stays legible.
 * PDFs and files already small enough are returned unchanged.
 */
export async function shrinkImage(file: File, maxSide = 2000, quality = 0.82, keepBelowBytes = 1_500_000): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= keepBelowBytes) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    // HEIC and other formats the browser cannot decode are uploaded as they are.
    return file;
  }
}
