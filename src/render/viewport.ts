import type { CanvasViewState, Rect } from "../parse/model";

export interface ScreenPoint {
  x: number;
  y: number;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 64;

/**
 * Maps Concepts' Y-up world coordinates to Y-down canvas pixels.
 *
 * screenX = tx + worldX * scale
 * screenY = height - (ty + worldY * scale)
 */
export class Viewport {
  scale = 1;
  tx = 0;
  ty = 0;
  width = 0;
  height = 0;

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  worldToScreen(x: number, y: number): ScreenPoint {
    return {
      x: this.tx + x * this.scale,
      y: this.height - (this.ty + y * this.scale),
    };
  }

  screenToWorld(x: number, y: number): ScreenPoint {
    return {
      x: (x - this.tx) / this.scale,
      y: (this.height - y - this.ty) / this.scale,
    };
  }

  fit(bounds: Rect, padding = 32): void {
    const availableWidth = Math.max(1, this.width - padding * 2);
    const availableHeight = Math.max(1, this.height - padding * 2);
    const boundsWidth = Math.max(bounds.width, 1e-6);
    const boundsHeight = Math.max(bounds.height, 1e-6);
    const scale = clamp(
      Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
      MIN_SCALE,
      MAX_SCALE,
    );

    this.scale = scale;
    this.tx = this.width / 2 - (bounds.x + bounds.width / 2) * scale;
    this.ty = this.height / 2 - (bounds.y + bounds.height / 2) * scale;
  }

  resetToSaved(view: CanvasViewState): void {
    this.scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
    this.tx = this.width / 2 + view.tx * this.scale;
    this.ty = this.height / 2 + view.ty * this.scale;
  }

  setExact(bounds: Rect, scale: number): void {
    this.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    this.width = Math.max(1, Math.ceil(bounds.width * this.scale));
    this.height = Math.max(1, Math.ceil(bounds.height * this.scale));
    this.tx = -bounds.x * this.scale;
    this.ty = -bounds.y * this.scale;
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      return;
    }
    const world = this.screenToWorld(screenX, screenY);
    const nextScale = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    if (nextScale === this.scale) {
      return;
    }
    this.scale = nextScale;
    this.tx = screenX - world.x * nextScale;
    this.ty = this.height - screenY - world.y * nextScale;
  }

  zoomAtCenter(factor: number): void {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty -= dy;
  }

  get zoomPercent(): number {
    return Math.round(this.scale * 100);
  }

  get worldBounds(): Rect {
    return {
      x: -this.tx / this.scale,
      y: -this.ty / this.scale,
      width: this.width / this.scale,
      height: this.height / this.scale,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
