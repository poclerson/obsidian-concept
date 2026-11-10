import type { ConceptDocument, ConceptImage } from "../parse/model";

export class ImageCache {
  private readonly images = new Map<string, CanvasImageSource>();
  private readonly objectUrls = new Set<string>();
  private readonly bitmaps = new Set<ImageBitmap>();
  private readonly pending = new Map<string, Promise<void>>();

  get(item: ConceptImage): CanvasImageSource | null {
    return this.images.get(item.id) ?? null;
  }

  has(item: ConceptImage): boolean {
    return this.images.has(item.id);
  }

  async loadAll(document: ConceptDocument): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const item of document.items) {
      if (item.kind === "image" && item.data) {
        tasks.push(this.loadOne(item));
      }
    }
    await Promise.allSettled(tasks);
  }

  private loadOne(item: ConceptImage): Promise<void> {
    const existing = this.pending.get(item.id);
    if (existing) {
      return existing;
    }
    if (!item.data) {
      return Promise.resolve();
    }

    const task = this.load(item.data)
      .then((image) => {
        this.images.set(item.id, image);
      })
      .catch(() => {
        // The renderer falls back to a placeholder when an image is missing.
      })
      .finally(() => {
        this.pending.delete(item.id);
      });

    this.pending.set(item.id, task);
    return task;
  }

  private async load(data: Uint8Array): Promise<CanvasImageSource> {
    const mime = detectMimeType(data);
    const blob = new Blob([copyToArrayBuffer(data)], { type: mime });

    if (typeof createImageBitmap === "function" && !mime.includes("svg")) {
      try {
        const bitmap = await createImageBitmap(blob);
        this.bitmaps.add(bitmap);
        return bitmap;
      } catch {
        // Fall through to an HTMLImageElement, which supports more formats.
      }
    }

    return await this.loadHtmlImage(blob);
  }

  private loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      this.objectUrls.add(url);
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        URL.revokeObjectURL(url);
        this.objectUrls.delete(url);
        reject(new Error("Could not decode image"));
      };
      image.src = url;
    });
  }

  clear(): void {
    for (const bitmap of this.bitmaps) {
      bitmap.close();
    }
    this.bitmaps.clear();
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
    this.images.clear();
    this.pending.clear();
  }

  dispose(): void {
    this.clear();
  }
}

export function detectMimeType(data: Uint8Array): string {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47])) {
    return "image/png";
  }
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(data, [0x47, 0x49, 0x46, 0x38])) {
    return "image/gif";
  }
  if (
    startsWith(data, [0x52, 0x49, 0x46, 0x46]) &&
    data.length > 12 &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46])) {
    return "application/pdf";
  }

  const head = new TextDecoder().decode(data.subarray(0, 256)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

function startsWith(data: Uint8Array, signature: number[]): boolean {
  if (data.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => data[index] === byte);
}

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.slice().buffer as ArrayBuffer;
}
