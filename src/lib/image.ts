// Client-side image work for product photos. Runs in the browser so the app
// needs no server-side image library, and one decode gives us everything.
//
// Uploads previously stored the phone's original — up to 5 MB — and /products
// served those full-size files as 64x64 thumbnails. A typeahead dropdown full
// of them would be painful on mobile data, so every upload is now downscaled
// first. The same canvas pass also yields the perceptual hash.

const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Your browser could not process the image.");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx;
}

/**
 * dHash: shrink to 9x8 greyscale, then compare each pixel with the one to its
 * right. 8 rows x 8 comparisons = 64 bits. Returned as a 64-character binary
 * string so it can be passed straight to a Postgres `bit(64)` column.
 *
 * Chosen over pHash because it needs no DCT — a few lines of canvas work rather
 * than a dependency — and it is more than adequate for catching the same
 * product photographed or re-saved twice.
 */
export function dHash(img: HTMLImageElement): string {
  const ctx = draw(img, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  const grey: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma — matches what the eye weights, unlike a flat average.
    grey.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = grey[row * 9 + col];
      const right = grey[row * 9 + col + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return bits;
}

/** Bits differing between two 64-bit hashes. ~5 or below means near-identical. */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export interface ProcessedImage {
  file: File;        // downscaled, ready to upload
  dataUrl: string;   // small preview for the form
  hash: string;      // 64-bit dHash
  originalKb: number;
  processedKb: number;
}

/** Downscale, make a preview, and hash — from a single decode of the file. */
export async function processImage(file: File): Promise<ProcessedImage> {
  const img = await loadImage(file);
  const hash = dHash(img);

  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const ctx = draw(img, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    ctx.canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) throw new Error("Could not compress the image.");

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return {
    file: new File([blob], name, { type: "image/jpeg" }),
    dataUrl: ctx.canvas.toDataURL("image/jpeg", 0.6),
    hash,
    originalKb: Math.round(file.size / 1024),
    processedKb: Math.round(blob.size / 1024),
  };
}
