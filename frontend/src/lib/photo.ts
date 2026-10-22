"use client";
// Shrink a camera photo on the device before upload (poor signal in bazaars): longest side 1024 px, JPEG.
// The photo is kept only in this tab's sessionStorage until the /snap screen has read it.
const KEY = "tg-snap";
const MAX = 1024;

export async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error("این فایل عکس نیست یا باز نمی‌شود.")); i.src = url;
    });
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height); // browsers apply the EXIF rotation when decoding
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const keepPhoto = (dataUrl: string) => { try { sessionStorage.setItem(KEY, dataUrl); } catch {} };
export const takePhoto = (): string | null => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
export const dropPhoto = () => { try { sessionStorage.removeItem(KEY); } catch {} };
