import type { Mat4 } from "./transform";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  angle: number;
}

export interface Stroke {
  kind: "stroke";
  id: string;
  points: StrokePoint[];
  /** World-space stroke width. */
  width: number;
  color: Color;
  opacity: number;
  isEraser: boolean;
  hasPressure: boolean;
  bounds: Rect;
}

export interface ConceptImage {
  kind: "image";
  id: string;
  resourceId: string;
  data: Uint8Array | null;
  /** World-space image size before the transform is applied. */
  width: number;
  height: number;
  transform: Mat4;
  crop: Rect | null;
  opacity: number;
  bounds: Rect;
}

export interface ConceptText {
  kind: "text";
  id: string;
  text: string;
  transform: Mat4;
  color: Color;
  opacity: number;
  /** World-space font size. */
  fontSize: number;
  fontFamily: string | null;
  bounds: Rect;
}

export interface ConceptPdfPage {
  kind: "pdf";
  id: string;
  resourceId: string;
  page: number;
  data: Uint8Array | null;
  /** World-space page size before the transform is applied. */
  width: number;
  height: number;
  transform: Mat4;
  opacity: number;
  bounds: Rect;
}

export type ConceptItem = Stroke | ConceptImage | ConceptText | ConceptPdfPage;

export interface LayerEntry {
  kind: "item";
  item: ConceptItem;
}

export interface LayerNodeEntry {
  kind: "layer";
  layer: LayerNode;
}

export type LayerChild = LayerEntry | LayerNodeEntry;

export interface LayerNode {
  id: string;
  name: string;
  children: LayerChild[];
}

export interface GridSettings {
  enabled: boolean;
  /** World-space spacing between major grid lines. */
  spacing: number;
  color: Color;
  opacity: number;
}

export interface CanvasViewState {
  scale: number;
  tx: number;
  ty: number;
  raw: string;
}

export interface DocumentStats {
  strokeCount: number;
  imageCount: number;
  textCount: number;
  pdfPageCount: number;
  totalPoints: number;
}

export interface ConceptDocument {
  name: string;
  layers: LayerNode[];
  /** Flattened display list in painting order. */
  items: ConceptItem[];
  background: Color;
  grid: GridSettings | null;
  canvasView: CanvasViewState | null;
  thumbnail: Uint8Array | null;
  imageResources: Map<string, Uint8Array>;
  pdfResources: Map<string, Uint8Array>;
  bounds: Rect;
  stats: DocumentStats;
  warnings: string[];
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 1, height: 1 };

export function rectFromPoints(points: readonly Vec2[]): Rect {
  if (points.length === 0) {
    return { ...EMPTY_RECT };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function rectFromCorners(
  points: readonly [Vec2, Vec2, Vec2, Vec2],
): Rect {
  return rectFromPoints(points);
}

export function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;

  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function intersectsRect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function rectToPolygon(rect: Rect): Vec2[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

export function colorToCss(color: Color, alpha = color.a): string {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

export function colorLuminance(color: Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
