import {
  colorLuminance,
  colorToCss,
  intersectsRect,
  type Color,
  type ConceptDocument,
  type ConceptImage,
  type ConceptItem,
  type ConceptPdfPage,
  type ConceptText,
  type Rect,
  type Stroke,
} from "../parse/model";
import { ImageCache } from "./image-cache";
import { Viewport } from "./viewport";

export type BackgroundMode = "paper" | "light" | "dark" | "theme" | "checker";

export interface PaintOptions {
  backgroundMode: BackgroundMode;
  showGrid: boolean;
  showBounds: boolean;
  adaptStrokeColors: boolean;
  strokeWidthMultiplier: number;
}

export type InitialView = "fit" | "saved";

export const DEFAULT_PAINT_OPTIONS: PaintOptions = {
  backgroundMode: "paper",
  showGrid: false,
  showBounds: false,
  adaptStrokeColors: true,
  strokeWidthMultiplier: 1,
};

const LIGHT_BACKGROUND: Color = { r: 1, g: 1, b: 1, a: 1 };
const DARK_BACKGROUND: Color = { r: 0.1, g: 0.105, b: 0.11, a: 1 };
const EXPORT_MAX_DIMENSION = 8192;

export class ConceptRenderer {
  readonly viewport = new Viewport();
  onRender: (() => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly contentCanvas: HTMLCanvasElement;
  private readonly images = new ImageCache();
  private doc: ConceptDocument | null = null;
  private options: PaintOptions;
  private dpr = 1;
  private initialized = false;
  private initialView: InitialView = "fit";
  private frame = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: Partial<PaintOptions> = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create a 2D canvas context");
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.contentCanvas = canvas.ownerDocument.createElement("canvas");
    this.options = { ...DEFAULT_PAINT_OPTIONS, ...options };
  }

  get document(): ConceptDocument | null {
    return this.doc;
  }

  get paintOptions(): PaintOptions {
    return this.options;
  }

  get zoomPercent(): number {
    return this.viewport.zoomPercent;
  }

  setDocument(document: ConceptDocument, initialView: InitialView = "fit"): void {
    this.doc = document;
    this.initialView = initialView;
    this.initialized = false;
    this.images.clear();
    void this.images.loadAll(document).then(() => this.requestRender());

    if (this.viewport.width > 0 && this.viewport.height > 0) {
      this.applyInitialView();
    }
    this.requestRender();
  }

  setOptions(options: Partial<PaintOptions>): void {
    this.options = { ...this.options, ...options };
    this.requestRender();
  }

  resize(width: number, height: number, dpr = 1): void {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const safeDpr = Math.max(1, dpr);

    this.dpr = safeDpr;
    this.canvas.width = Math.max(1, Math.round(safeWidth * safeDpr));
    this.canvas.height = Math.max(1, Math.round(safeHeight * safeDpr));
    this.viewport.setSize(safeWidth, safeHeight);

    if (this.doc && !this.initialized) {
      this.applyInitialView();
    }
    this.requestRender();
  }

  fitToContent(): void {
    if (!this.doc) {
      return;
    }
    this.viewport.fit(this.doc.bounds, 32);
    this.initialized = true;
    this.requestRender();
  }

  resetView(): void {
    if (!this.doc) {
      return;
    }
    if (this.doc.canvasView) {
      this.viewport.resetToSaved(this.doc.canvasView);
    } else {
      this.viewport.fit(this.doc.bounds, 32);
    }
    this.initialized = true;
    this.requestRender();
  }

  zoomBy(factor: number, anchorX?: number, anchorY?: number): void {
    this.viewport.zoomAt(
      anchorX ?? this.viewport.width / 2,
      anchorY ?? this.viewport.height / 2,
      factor,
    );
    this.requestRender();
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    this.viewport.zoomAt(screenX, screenY, factor);
    this.requestRender();
  }

  panBy(dx: number, dy: number): void {
    this.viewport.panBy(dx, dy);
    this.requestRender();
  }

  requestRender(): void {
    if (this.disposed || this.frame !== 0) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render(): void {
    if (!this.doc || this.disposed) {
      return;
    }
    paintScene(
      this.ctx,
      this.viewport.width,
      this.viewport.height,
      this.dpr,
      this.doc,
      this.viewport,
      this.options,
      this.images,
      this.contentCanvas,
    );
    this.onRender?.();
  }

  async exportPng(scale = 2): Promise<Blob> {
    if (!this.doc) {
      throw new Error("No concept document is loaded");
    }

    const bounds = this.doc.bounds;
    const maxDimension = Math.max(bounds.width, bounds.height, 1);
    const exportScale = Math.max(
      0.1,
      Math.min(scale, EXPORT_MAX_DIMENSION / maxDimension),
    );
    const width = Math.max(1, Math.ceil(bounds.width * exportScale));
    const height = Math.max(1, Math.ceil(bounds.height * exportScale));

    const canvas = this.canvas.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create an export canvas");
    }

    const viewport = new Viewport();
    viewport.setExact(bounds, exportScale);
    const contentCanvas = this.canvas.ownerDocument.createElement("canvas");
    paintScene(
      ctx,
      width,
      height,
      1,
      this.doc,
      viewport,
      { ...this.options, showBounds: false, showGrid: false },
      this.images,
      contentCanvas,
    );

    return await canvasToBlob(canvas);
  }

  dispose(): void {
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.disposed = true;
    this.images.dispose();
    this.doc = null;
  }

  private applyInitialView(): void {
    if (!this.doc) {
      return;
    }
    if (this.initialView === "saved" && this.doc.canvasView) {
      this.viewport.resetToSaved(this.doc.canvasView);
    } else {
      this.viewport.fit(this.doc.bounds, 32);
    }
    this.initialized = true;
  }
}

export function paintScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  document: ConceptDocument,
  viewport: Viewport,
  options: PaintOptions,
  images: ImageCache,
  contentCanvas: HTMLCanvasElement,
): void {
  const background = resolveBackground(document, options.backgroundMode);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  paintBackground(ctx, width, height, options.backgroundMode, background);

  if (options.showGrid) {
    paintGrid(ctx, dpr, document, viewport, background);
  }

  paintContent(
    ctx,
    width,
    height,
    dpr,
    document,
    viewport,
    options,
    images,
    contentCanvas,
    background,
  );

  if (options.showBounds) {
    paintBounds(ctx, dpr, document.bounds, viewport);
  }
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: BackgroundMode,
  background: Color,
): void {
  if (mode !== "checker") {
    ctx.fillStyle = colorToCss(background);
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const dark = isDarkTheme();
  const size = 10;
  ctx.fillStyle = dark ? "#191919" : "#f2f2f2";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = dark ? "#232323" : "#e7e7e7";
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if (((x / size) | 0) % 2 === ((y / size) | 0) % 2) {
        ctx.fillRect(x, y, size, size);
      }
    }
  }
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  document: ConceptDocument,
  viewport: Viewport,
  background: Color,
): void {
  const grid = document.grid;
  const spacing = grid && grid.spacing > 1 ? grid.spacing : 50;
  const color = adaptiveGridColor(grid?.color ?? { r: 0.3, g: 0.5, b: 0.8, a: 1 }, background);
  const opacity = grid?.opacity ?? 0.2;
  const world = viewport.worldBounds;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(viewport.tx, viewport.height - viewport.ty);
  ctx.scale(viewport.scale, -viewport.scale);
  ctx.lineWidth = 1 / viewport.scale;

  const minorSpacing = spacing / 4;
  if (minorSpacing * viewport.scale >= 6) {
    ctx.strokeStyle = colorToCss(color, opacity * 0.35);
    strokeGridLines(ctx, world, minorSpacing);
  }

  ctx.strokeStyle = colorToCss(color, opacity);
  strokeGridLines(ctx, world, spacing);
  ctx.restore();
}

function strokeGridLines(
  ctx: CanvasRenderingContext2D,
  world: Rect,
  spacing: number,
): void {
  const startX = Math.floor(world.x / spacing) * spacing;
  const endX = Math.ceil((world.x + world.width) / spacing) * spacing;
  const startY = Math.floor(world.y / spacing) * spacing;
  const endY = Math.ceil((world.y + world.height) / spacing) * spacing;

  const count =
    (endX - startX) / spacing + (endY - startY) / spacing;
  if (!Number.isFinite(count) || count > 4000) {
    return;
  }

  ctx.beginPath();
  for (let x = startX; x <= endX; x += spacing) {
    ctx.moveTo(x, world.y);
    ctx.lineTo(x, world.y + world.height);
  }
  for (let y = startY; y <= endY; y += spacing) {
    ctx.moveTo(world.x, y);
    ctx.lineTo(world.x + world.width, y);
  }
  ctx.stroke();
}

function paintContent(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  document: ConceptDocument,
  viewport: Viewport,
  options: PaintOptions,
  images: ImageCache,
  contentCanvas: HTMLCanvasElement,
  background: Color,
): void {
  const deviceWidth = Math.max(1, Math.round(width * dpr));
  const deviceHeight = Math.max(1, Math.round(height * dpr));
  if (contentCanvas.width !== deviceWidth) {
    contentCanvas.width = deviceWidth;
  }
  if (contentCanvas.height !== deviceHeight) {
    contentCanvas.height = deviceHeight;
  }

  const content = contentCanvas.getContext("2d");
  if (!content) {
    return;
  }

  content.setTransform(1, 0, 0, 1, 0, 0);
  content.clearRect(0, 0, deviceWidth, deviceHeight);
  content.setTransform(dpr, 0, 0, dpr, 0, 0);
  content.translate(viewport.tx, viewport.height - viewport.ty);
  content.scale(viewport.scale, -viewport.scale);
  content.lineCap = "round";
  content.lineJoin = "round";

  const world = viewport.worldBounds;
  for (const item of document.items) {
    if (!intersectsRect(item.bounds, world)) {
      continue;
    }
    paintItem(content, item, viewport.scale, options, background, images);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(contentCanvas, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function paintItem(
  ctx: CanvasRenderingContext2D,
  item: ConceptItem,
  scale: number,
  options: PaintOptions,
  background: Color,
  images: ImageCache,
): void {
  switch (item.kind) {
    case "stroke":
      paintStroke(ctx, item, options, background);
      break;
    case "image":
      paintImage(ctx, item, scale, options, background, images);
      break;
    case "text":
      paintText(ctx, item, options, background);
      break;
    case "pdf":
      paintPdfPage(ctx, item, scale);
      break;
  }
}

function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  options: PaintOptions,
  background: Color,
): void {
  if (stroke.points.length === 0 || stroke.isMask) {
    return;
  }

  const color = adaptColor(stroke.color, options, background);
  ctx.globalCompositeOperation = stroke.isEraser
    ? "destination-out"
    : "source-over";
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = colorToCss(color);
  ctx.fillStyle = colorToCss(color);
  ctx.lineWidth = Math.max(0.05, stroke.width * options.strokeWidthMultiplier);

  if (stroke.isFill) {
    ctx.beginPath();
    const first = stroke.points[0];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      const point = stroke.points[i];
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    const first = stroke.points[0];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      const point = stroke.points[i];
      ctx.lineTo(point.x, point.y);
    }
    if (stroke.closed) {
      ctx.closePath();
    }
    if (stroke.brushTool === 6) {
      // Dotted brush: round caps with a tiny dash and a width-sized gap.
      ctx.setLineDash([0.001, Math.max(ctx.lineWidth * 1.8, 1)]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  image: ConceptImage,
  scale: number,
  options: PaintOptions,
  background: Color,
  images: ImageCache,
): void {
  const m = image.transform.m;
  const source = images.get(image);

  ctx.save();
  ctx.globalAlpha = image.opacity;
  ctx.translate(m[12], m[13]);
  ctx.transform(m[0], m[1], m[4], m[5], 0, 0);
  ctx.scale(1, -1);

  if (source) {
    const sourceSize = getSourceSize(source, image.width, image.height);
    const crop = image.crop;
    const sx = crop ? crop.x * sourceSize.width : 0;
    const sy = crop ? crop.y * sourceSize.height : 0;
    const sw = crop ? crop.width * sourceSize.width : sourceSize.width;
    const sh = crop ? crop.height * sourceSize.height : sourceSize.height;
    ctx.drawImage(
      source,
      sx,
      sy,
      sw,
      sh,
      -image.width / 2,
      -image.height / 2,
      image.width,
      image.height,
    );
  } else {
    ctx.fillStyle = "rgba(128, 128, 128, 0.08)";
    ctx.fillRect(-image.width / 2, -image.height / 2, image.width, image.height);
    ctx.strokeStyle = "rgba(128, 128, 128, 0.7)";
    ctx.lineWidth = Math.max(0.5, 1 / scale);
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.strokeRect(-image.width / 2, -image.height / 2, image.width, image.height);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function paintText(
  ctx: CanvasRenderingContext2D,
  text: ConceptText,
  options: PaintOptions,
  background: Color,
): void {
  const m = text.transform.m;
  const color = adaptColor(text.color, options, background);

  ctx.save();
  ctx.globalAlpha = text.opacity;
  ctx.fillStyle = colorToCss(color);
  ctx.translate(m[12], m[13]);
  ctx.transform(m[0], m[1], m[4], m[5], 0, 0);
  ctx.scale(1, -1);
  ctx.font = `${Math.max(1, text.fontSize)}px ${text.fontFamily ?? "sans-serif"}`;
  ctx.textBaseline = "top";
  const lines = text.text.split(/\r?\n/);
  const lineHeight = text.fontSize * 1.2;
  lines.forEach((line, index) => {
    ctx.fillText(line, 0, index * lineHeight);
  });
  ctx.restore();
}

function paintPdfPage(
  ctx: CanvasRenderingContext2D,
  page: ConceptPdfPage,
  scale: number,
): void {
  const m = page.transform.m;

  ctx.save();
  ctx.globalAlpha = page.opacity;
  ctx.translate(m[12], m[13]);
  ctx.transform(m[0], m[1], m[4], m[5], 0, 0);
  ctx.fillStyle = "rgba(233, 30, 99, 0.06)";
  ctx.fillRect(-page.width / 2, -page.height / 2, page.width, page.height);
  ctx.strokeStyle = "rgba(210, 40, 100, 0.65)";
  ctx.lineWidth = Math.max(0.5, 1 / scale);
  ctx.setLineDash([8 / scale, 6 / scale]);
  ctx.strokeRect(-page.width / 2, -page.height / 2, page.width, page.height);
  ctx.setLineDash([]);

  ctx.scale(1, -1);
  ctx.fillStyle = "rgba(190, 30, 80, 0.9)";
  ctx.font = `${Math.max(8, 14 / scale)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`PDF page ${page.page}`, 0, 0);
  ctx.restore();
}

function paintBounds(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  bounds: Rect,
  viewport: Viewport,
): void {
  const topLeft = viewport.worldToScreen(bounds.x, bounds.y + bounds.height);
  const bottomRight = viewport.worldToScreen(
    bounds.x + bounds.width,
    bounds.y,
  );

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "rgba(128, 128, 128, 0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );
  ctx.setLineDash([]);
  ctx.restore();
}

function resolveBackground(
  document: ConceptDocument,
  mode: BackgroundMode,
): Color {
  switch (mode) {
    case "paper":
      return document.background;
    case "light":
      return LIGHT_BACKGROUND;
    case "dark":
      return DARK_BACKGROUND;
    case "theme":
      return isDarkTheme() ? DARK_BACKGROUND : LIGHT_BACKGROUND;
    case "checker":
      return isDarkTheme() ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  }
}

function adaptiveGridColor(color: Color, background: Color): Color {
  const backgroundLuminance = colorLuminance(background);
  const colorLuminanceValue = colorLuminance(color);
  if (Math.abs(backgroundLuminance - colorLuminanceValue) > 0.25) {
    return color;
  }
  return backgroundLuminance < 0.4
    ? { r: 0.75, g: 0.8, b: 0.9, a: color.a }
    : { r: 0.25, g: 0.4, b: 0.65, a: color.a };
}

function adaptColor(
  color: Color,
  options: PaintOptions,
  background: Color,
): Color {
  if (!options.adaptStrokeColors) {
    return color;
  }
  const backgroundLuminance = colorLuminance(background);
  const luminance = colorLuminance(color);
  if (backgroundLuminance < 0.4 && luminance < 0.3) {
    return { r: 0.92, g: 0.92, b: 0.92, a: color.a };
  }
  if (backgroundLuminance >= 0.4 && luminance > 0.88) {
    return { r: 0.1, g: 0.1, b: 0.1, a: color.a };
  }
  return color;
}

function getSourceSize(
  source: CanvasImageSource,
  fallbackWidth: number,
  fallbackHeight: number,
): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width || fallbackWidth,
      height: source.naturalHeight || source.height || fallbackHeight,
    };
  }
  const sized = source as { width?: number; height?: number };
  return {
    width: sized.width || fallbackWidth,
    height: sized.height || fallbackHeight,
  };
}

function isDarkTheme(): boolean {
  return (
    typeof document !== "undefined" &&
    document.body.classList.contains("theme-dark")
  );
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not encode PNG"));
      }
    }, "image/png");
  });
}
