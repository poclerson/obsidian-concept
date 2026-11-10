import {
  asArray,
  asBoolean,
  asData,
  asDict,
  asNumber,
  asString,
  deref,
  isPlistUid,
  parseBinaryPlist,
  readNsArray,
  type PlistValue,
} from "./bplist";
import {
  EMPTY_RECT,
  expandRect,
  rectFromPoints,
  unionRect,
  type CanvasViewState,
  type Color,
  type ConceptDocument,
  type ConceptImage,
  type ConceptItem,
  type ConceptPdfPage,
  type ConceptText,
  type DocumentStats,
  type GridSettings,
  type LayerChild,
  type LayerNode,
  type Rect,
  type Stroke,
  type StrokePoint,
  type Vec2,
} from "./model";
import {
  IDENTITY_MAT4,
  applyMat4,
  mat4Scale,
  parseMat4,
  type Mat4,
} from "./transform";
import { readConceptArchive, type ConceptArchive } from "./zip";

export class ConceptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConceptParseError";
  }
}

interface KeyedArchive {
  objects: PlistValue[];
  root: PlistValue | null;
}

const DEFAULT_BACKGROUND: Color = { r: 0.976, g: 0.976, b: 0.945, a: 1 };
const DEFAULT_GRID_COLOR: Color = { r: 0.28, g: 0.55, b: 0.78, a: 1 };

export function parseConceptFile(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
): ConceptDocument {
  const archive = readConceptArchive(input);
  return parseConceptArchive(archive, fileName);
}

export function parseConceptArchive(
  archive: ConceptArchive,
  fileName: string,
): ConceptDocument {
  const warnings: string[] = [];
  const entries = archive.entries;

  const strokesArchive = readArchive(
    findEntry(entries, "Strokes.plist"),
    "Strokes.plist",
    warnings,
  );
  const drawingArchive = readArchive(
    findEntry(entries, "Drawing.plist"),
    "Drawing.plist",
    warnings,
  );

  const itemsByObject = new Map<number, ConceptItem>();
  if (strokesArchive) {
    parseItems(strokesArchive, itemsByObject, warnings);
  }

  const layers = buildLayers(strokesArchive, itemsByObject, warnings);
  const items = flattenLayers(layers);

  const imageResources = collectResources(entries, (name) =>
    name.startsWith("ImportedImages/"),
  );
  const pdfResources = collectResources(entries, (name) =>
    /\.pdf$/i.test(name),
  );
  attachResources(items, imageResources, pdfResources, warnings);

  const background = parseBackground(drawingArchive) ?? DEFAULT_BACKGROUND;
  const grid = parseGrid(drawingArchive);
  const canvasView = parseCanvasView(drawingArchive);

  let bounds: Rect | null = null;
  for (const item of items) {
    bounds = unionRect(bounds, item.bounds);
  }

  const stats: DocumentStats = {
    strokeCount: items.filter((item) => item.kind === "stroke").length,
    imageCount: items.filter((item) => item.kind === "image").length,
    textCount: items.filter((item) => item.kind === "text").length,
    pdfPageCount: items.filter((item) => item.kind === "pdf").length,
    totalPoints: items.reduce(
      (total, item) =>
        item.kind === "stroke" ? total + item.points.length : total,
      0,
    ),
  };

  return {
    name: fileName.replace(/\.concept$/i, ""),
    layers,
    items,
    background,
    grid,
    canvasView,
    thumbnail: findEntry(entries, "Thumb.jpg") ?? null,
    imageResources,
    pdfResources,
    bounds: bounds ?? { ...EMPTY_RECT },
    stats,
    warnings,
  };
}

function readArchive(
  data: Uint8Array | undefined,
  label: string,
  warnings: string[],
): KeyedArchive | null {
  if (!data) {
    warnings.push(`${label} is missing from the archive.`);
    return null;
  }

  try {
    const parsed = parseBinaryPlist(data);
    const dict = asDict(parsed);
    const objects = dict ? asArray(dict["$objects"]) : null;
    if (!dict || !objects) {
      warnings.push(`${label} is not an NSKeyedArchiver plist.`);
      return null;
    }

    const top = asDict(dict["$top"]);
    const root = top
      ? deref(objects, top["root"])
      : objects.length > 1
        ? objects[1]
        : null;
    return { objects, root };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Could not parse ${label}: ${message}`);
    return null;
  }
}

function parseItems(
  archive: KeyedArchive,
  itemsByObject: Map<number, ConceptItem>,
  warnings: string[],
): void {
  const { objects } = archive;

  for (let index = 0; index < objects.length; index += 1) {
    const raw = asDict(objects[index]);
    if (!raw) {
      continue;
    }

    const className = getClassName(objects, raw);
    let item: ConceptItem | null = null;

    if (
      raw["strokePointsNonOptionalAngles"] !== undefined ||
      raw["strokePoints45"] !== undefined ||
      className === "Stroke"
    ) {
      item = parseStroke(objects, raw, index, warnings);
    } else if (
      raw["imageIdentifier"] !== undefined ||
      className === "ImageItem"
    ) {
      item = parseImage(objects, raw, index, warnings);
    } else if (
      className === "TextItem" ||
      (raw["text"] !== undefined && raw["diSavedTransform"] !== undefined)
    ) {
      item = parseText(objects, raw, index, warnings);
    } else if (
      className === "TiledPDFPage" ||
      (raw["page"] !== undefined &&
        raw["resourceIdentifier"] !== undefined &&
        raw["diSavedTransform"] !== undefined)
    ) {
      item = parsePdfPage(objects, raw, index, warnings);
    }

    if (item) {
      itemsByObject.set(index, item);
    }
  }
}

function parseStroke(
  objects: PlistValue[],
  raw: Record<string, PlistValue>,
  index: number,
  warnings: string[],
): Stroke | null {
  const pointsData = asData(
    deref(
      objects,
      raw["strokePointsNonOptionalAngles"] ?? raw["strokePoints45"],
    ),
  );
  if (!pointsData || pointsData.byteLength < 16) {
    warnings.push(`Stroke ${index} has no point data.`);
    return null;
  }

  const transform = parseMat4(asData(deref(objects, raw["diSavedTransform"])));
  const brush = asDict(deref(objects, raw["brushProperties"]));
  const tool = brush ? asNumber(deref(objects, brush["brushToolNew"])) : null;
  // brushWidth is stored in world units and is independent of the transform.
  // Fill strokes carry no width at all.
  const brushWidth =
    (brush ? asNumber(deref(objects, brush["brushWidth"])) : null) ?? 0;
  const width = tool === 11 ? 0 : Math.max(0.001, brushWidth || defaultBrushWidth(tool));
  const opacity = brush
    ? clamp01(asNumber(deref(objects, brush["brushAlpha"])) ?? 1)
    : 1;
  const color =
    (brush ? parseColor(objects, brush["brushColor"]) : null) ??
    ({ r: 0, g: 0, b: 0, a: 1 } satisfies Color);

  const points = decodeStrokePoints(pointsData, transform);
  if (points.length === 0) {
    warnings.push(`Stroke ${index} has no valid points.`);
    return null;
  }

  const bounds = expandRect(rectFromPoints(points), width / 2);
  return {
    kind: "stroke",
    id: asString(deref(objects, raw["diIdentifier"])) ?? `stroke-${index}`,
    points,
    width,
    color,
    opacity,
    brushTool: tool,
    isEraser: asBoolean(raw["isEraser"]) === true,
    // Tool ids 0 and 13 are the hard and soft masks. They carry no colour and
    // the app leaves no visible coverage where they are.
    isMask: tool === 0 || tool === 13,
    // Tool 11 is the fill tool: a closed contour painted with a solid color.
    isFill: tool === 11,
    closed: asBoolean(raw["closed"]) === true,
    hasPressure: asBoolean(raw["containsPressure"]) === true,
    bounds,
  };
}

function decodeStrokePoints(
  data: Uint8Array,
  transform: Mat4 | null,
): StrokePoint[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const stride = 16;
  const count = Math.floor(data.byteLength / stride);
  const points: StrokePoint[] = [];
  let lastRawX = 0;
  let lastRawY = 0;
  let hasLast = false;

  for (let i = 0; i < count; i += 1) {
    const offset = i * stride;
    const rawX = view.getFloat32(offset, true);
    const rawY = view.getFloat32(offset + 4, true);
    const pressure = view.getFloat32(offset + 8, true);
    const angle = view.getFloat32(offset + 12, true);

    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      continue;
    }

    // Concepts stores occasional "teleport" records between pen segments.
    if (hasLast) {
      const jump = Math.abs(rawX - lastRawX) + Math.abs(rawY - lastRawY);
      if (jump > 2000) {
        continue;
      }
    }

    lastRawX = rawX;
    lastRawY = rawY;
    hasLast = true;
    const point = applyMat4(transform, rawX, rawY);
    points.push({
      x: point.x,
      y: point.y,
      pressure: Number.isFinite(pressure)
        ? Math.max(0, Math.min(1, pressure))
        : 1,
      angle: Number.isFinite(angle) ? angle : 0,
    });
  }

  return points;
}

function defaultBrushWidth(tool: number | null): number {
  switch (tool) {
    case 0:
      return 14.1963;
    case 1:
      return 0.9784;
    default:
      return 1;
  }
}

function parseImage(
  objects: PlistValue[],
  raw: Record<string, PlistValue>,
  index: number,
  warnings: string[],
): ConceptImage | null {
  const resourceId = asString(deref(objects, raw["imageIdentifier"]));
  if (!resourceId) {
    warnings.push(`Image ${index} has no identifier.`);
    return null;
  }

  const [width, height] = parseSize(
    asString(deref(objects, raw["size"])),
  ) ?? [100, 100];
  const transform =
    parseMat4(asData(deref(objects, raw["diSavedTransform"]))) ??
    IDENTITY_MAT4;
  const crop = parseCrop(asString(deref(objects, raw["crop"])));
  const properties = asDict(deref(objects, raw["imageProperties"]));
  const opacity = properties
    ? clamp01(asNumber(deref(objects, properties["brushAlpha"])) ?? 1)
    : 1;

  return {
    kind: "image",
    id: asString(deref(objects, raw["diIdentifier"])) ?? resourceId,
    resourceId,
    data: null,
    width,
    height,
    transform,
    crop,
    opacity,
    bounds: transformedRect(transform, -width / 2, -height / 2, width, height),
  };
}

function parseText(
  objects: PlistValue[],
  raw: Record<string, PlistValue>,
  index: number,
  warnings: string[],
): ConceptText | null {
  const text = asString(deref(objects, raw["text"]));
  if (!text) {
    return null;
  }

  const transform =
    parseMat4(asData(deref(objects, raw["diSavedTransform"]))) ??
    IDENTITY_MAT4;
  const properties =
    asDict(deref(objects, raw["properties"])) ??
    asDict(deref(objects, raw["textProperties"]));
  const color =
    (properties ? parseColor(objects, properties["brushColor"]) : null) ??
    ({ r: 0, g: 0, b: 0, a: 1 } satisfies Color);
  const opacity = properties
    ? clamp01(asNumber(deref(objects, properties["brushAlpha"])) ?? 1)
    : 1;
  const fontSize =
    (properties
      ? asNumber(deref(objects, properties["fontSize"])) ??
        asNumber(deref(objects, properties["pointSize"])) ??
        asNumber(deref(objects, properties["textSize"]))
      : null) ??
    14 * mat4Scale(transform);
  const fontFamily =
    (properties
      ? asString(deref(objects, properties["fontName"])) ??
        asString(deref(objects, properties["fontFamily"]))
      : null) ?? null;

  const lines = text.split(/\r?\n/);
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const estimatedWidth = Math.max(fontSize, maxLineLength * fontSize * 0.6);
  const estimatedHeight = Math.max(fontSize, lines.length * fontSize * 1.2);

  return {
    kind: "text",
    id: asString(deref(objects, raw["diIdentifier"])) ?? `text-${index}`,
    text,
    transform,
    color,
    opacity,
    fontSize,
    fontFamily,
    bounds: transformedRect(transform, 0, -estimatedHeight, estimatedWidth, estimatedHeight),
  };
}

function parsePdfPage(
  objects: PlistValue[],
  raw: Record<string, PlistValue>,
  index: number,
  warnings: string[],
): ConceptPdfPage | null {
  const resourceId = asString(deref(objects, raw["resourceIdentifier"]));
  if (!resourceId) {
    warnings.push(`PDF page ${index} has no resource identifier.`);
    return null;
  }

  const [width, height] = parseSize(
    asString(deref(objects, raw["size"])),
  ) ?? [100, 100];
  const transform =
    parseMat4(asData(deref(objects, raw["diSavedTransform"]))) ??
    IDENTITY_MAT4;
  const properties = asDict(deref(objects, raw["pdfProperties"]));
  const opacity = properties
    ? clamp01(asNumber(deref(objects, properties["brushAlpha"])) ?? 1)
    : 1;

  return {
    kind: "pdf",
    id: asString(deref(objects, raw["diIdentifier"])) ?? `pdf-${index}`,
    resourceId,
    page: asNumber(raw["page"]) ?? 1,
    data: null,
    width,
    height,
    transform,
    opacity,
    bounds: transformedRect(transform, -width / 2, -height / 2, width, height),
  };
}

function buildLayers(
  archive: KeyedArchive | null,
  itemsByObject: Map<number, ConceptItem>,
  warnings: string[],
): LayerNode[] {
  if (!archive) {
    return fallbackLayers(itemsByObject);
  }

  const { objects, root } = archive;
  const rootDict = asDict(root);
  if (!rootDict) {
    return fallbackLayers(itemsByObject);
  }

  const placed = new Set<number>();
  const building = new Set<number>();

  const buildGroup = (ref: PlistValue | undefined): LayerNode | null => {
    if (!isPlistUid(ref)) {
      return null;
    }
    const index = ref.value;
    const raw = asDict(deref(objects, ref));
    if (!raw || building.has(index)) {
      return null;
    }

    building.add(index);
    try {
      const children: LayerChild[] = [];
      for (const childRef of readNsArray(objects, raw["groupItems"])) {
        const childIndex = isPlistUid(childRef) ? childRef.value : -1;
        const item = childIndex >= 0 ? itemsByObject.get(childIndex) : undefined;
        if (item) {
          if (!placed.has(childIndex)) {
            placed.add(childIndex);
            children.push({ kind: "item", item });
          }
          continue;
        }

        if (isGroup(objects, childRef)) {
          const layer = buildGroup(childRef);
          if (layer) {
            children.push({ kind: "layer", layer });
          }
        }
      }

      return {
        id: asString(deref(objects, raw["diIdentifier"])) ?? `layer-${index}`,
        name: asString(deref(objects, raw["name"])) ?? `Layer ${index}`,
        visible: asBoolean(deref(objects, raw["diVisible"])) !== false,
        opacity: clamp01(asNumber(deref(objects, raw["alpha"])) ?? 1),
        children,
      };
    } finally {
      building.delete(index);
    }
  };

  const layers: LayerNode[] = [];
  for (const ref of readNsArray(objects, rootDict["rootGroupLayers"])) {
    const layer = buildGroup(ref);
    if (layer) {
      layers.push(layer);
    }
  }

  const unplaced: LayerChild[] = [];
  for (const [index, item] of itemsByObject) {
    if (!placed.has(index)) {
      placed.add(index);
      unplaced.push({ kind: "item", item });
    }
  }
  if (unplaced.length > 0) {
    layers.push({
      id: "ungrouped",
      name: "Ungrouped",
      visible: true,
      opacity: 1,
      children: unplaced,
    });
  }

  if (layers.length === 0 && itemsByObject.size > 0) {
    warnings.push("No layer tree found; using object order.");
    return fallbackLayers(itemsByObject);
  }

  return layers;
}

function fallbackLayers(itemsByObject: Map<number, ConceptItem>): LayerNode[] {
  if (itemsByObject.size === 0) {
    return [];
  }
  return [
    {
      id: "drawing",
      name: "Drawing",
      visible: true,
      opacity: 1,
      children: Array.from(itemsByObject.values()).map((item) => ({
        kind: "item",
        item,
      })),
    },
  ];
}

function flattenLayers(layers: LayerNode[]): ConceptItem[] {
  const items: ConceptItem[] = [];
  const visit = (layer: LayerNode, inheritedOpacity: number): void => {
    if (!layer.visible) {
      return;
    }
    const opacity = clamp01(inheritedOpacity * clamp01(layer.opacity));
    for (const child of layer.children) {
      if (child.kind === "item") {
        if (opacity < 1) {
          child.item.opacity = clamp01(child.item.opacity * opacity);
        }
        items.push(child.item);
      } else {
        visit(child.layer, opacity);
      }
    }
  };
  for (const layer of layers) {
    visit(layer, 1);
  }
  return items;
}

function isGroup(objects: PlistValue[], ref: PlistValue): boolean {
  const raw = asDict(deref(objects, ref));
  if (!raw) {
    return false;
  }
  return raw["groupItems"] !== undefined || getClassName(objects, raw) === "DrawingItemGroup";
}

function getClassName(
  objects: PlistValue[],
  raw: Record<string, PlistValue>,
): string | null {
  const cls = asDict(deref(objects, raw["$class"]));
  return cls ? asString(cls["$classname"]) : null;
}

function parseBackground(archive: KeyedArchive | null): Color | null {
  if (!archive) {
    return null;
  }
  const root = asDict(archive.root);
  const canvasState = root
    ? asDict(deref(archive.objects, root["canvasState"]))
    : null;
  const background = canvasState
    ? asDict(deref(archive.objects, canvasState["backgroundSettings"]))
    : null;
  return background
    ? parseColor(archive.objects, background["drawingBackgroundColor"])
    : null;
}

function parseGrid(archive: KeyedArchive | null): GridSettings | null {
  if (!archive) {
    return null;
  }
  const root = asDict(archive.root);
  const grid = root
    ? asDict(deref(archive.objects, root["grid"]))
    : null;
  if (!grid) {
    return null;
  }

  const custom = asDict(deref(archive.objects, grid["customGridProperties"]));
  const spacingData = custom
    ? asData(deref(archive.objects, custom["majorSpacing"]))
    : null;
  let spacing = 50;
  if (spacingData && spacingData.byteLength >= 4) {
    const view = new DataView(
      spacingData.buffer,
      spacingData.byteOffset,
      spacingData.byteLength,
    );
    const candidate = view.getFloat32(0, true);
    if (Number.isFinite(candidate) && candidate > 0) {
      spacing = candidate;
    }
  }

  const color = custom
    ? parseColor(archive.objects, custom["color"])
    : null;
  const alpha = custom
    ? asNumber(deref(archive.objects, custom["alphaMajor"]))
    : null;

  return {
    enabled: asBoolean(deref(archive.objects, grid["enabled"])) ?? false,
    spacing,
    color: color ?? DEFAULT_GRID_COLOR,
    opacity: alpha === null ? 0.22 : alpha > 1 ? alpha / 255 : clamp01(alpha),
  };
}

function parseCanvasView(archive: KeyedArchive | null): CanvasViewState | null {
  if (!archive) {
    return null;
  }
  const root = asDict(archive.root);
  const canvasState = root
    ? asDict(deref(archive.objects, root["canvasState"]))
    : null;
  const transform = canvasState
    ? asDict(deref(archive.objects, canvasState["transform"]))
    : null;
  const raw = transform
    ? asString(deref(archive.objects, transform["savedTransform"]))
    : null;
  if (!raw) {
    return null;
  }

  const match = raw.match(
    /\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/,
  );
  if (!match) {
    return null;
  }

  const scale = Math.abs(Number(match[1]));
  const tx = Number(match[5]);
  const ty = Number(match[6]);
  if (![scale, tx, ty].every(Number.isFinite) || scale <= 0) {
    return null;
  }

  return { scale, tx, ty, raw };
}

function parseColor(
  objects: PlistValue[],
  value: PlistValue | undefined,
): Color | null {
  const dict = asDict(deref(objects, value));
  if (!dict) {
    return null;
  }

  let r = asNumber(deref(objects, dict["UIRed"]));
  let g = asNumber(deref(objects, dict["UIGreen"]));
  let b = asNumber(deref(objects, dict["UIBlue"]));
  const a = asNumber(deref(objects, dict["UIAlpha"])) ?? 1;

  if (r === null || g === null || b === null) {
    const nsrgb = asData(deref(objects, dict["NSRGB"]));
    if (nsrgb) {
      const parts = new TextDecoder().decode(nsrgb).trim().split(/\s+/);
      if (parts.length >= 3) {
        r = Number(parts[0]);
        g = Number(parts[1]);
        b = Number(parts[2]);
      }
    }
  }

  if (r === null || g === null || b === null) {
    return null;
  }

  return {
    r: clamp01(r),
    g: clamp01(g),
    b: clamp01(b),
    a: clamp01(a),
  };
}

function parseSize(value: string | null): [number, number] | null {
  if (!value) {
    return null;
  }
  const match = value.match(
    /\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}/,
  );
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return [width, height];
}

function parseCrop(value: string | null): Rect | null {
  if (!value) {
    return null;
  }
  const match = value.match(
    /\{\s*\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}\s*,\s*\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}\s*\}/,
  );
  if (!match) {
    return null;
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  const width = Number(match[3]);
  const height = Number(match[4]);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
}

function transformedRect(
  transform: Mat4,
  x: number,
  y: number,
  width: number,
  height: number,
): Rect {
  const corners: Vec2[] = [
    applyMat4(transform, x, y),
    applyMat4(transform, x + width, y),
    applyMat4(transform, x + width, y + height),
    applyMat4(transform, x, y + height),
  ];
  return rectFromPoints(corners);
}

function collectResources(
  entries: Map<string, Uint8Array>,
  include: (name: string) => boolean,
): Map<string, Uint8Array> {
  const resources = new Map<string, Uint8Array>();
  for (const [name, data] of entries) {
    if (!include(name)) {
      continue;
    }
    const base = name.split("/").pop() ?? name;
    const stem = base.replace(/\.[^.]+$/, "");
    resources.set(base, data);
    resources.set(stem, data);
  }
  return resources;
}

function attachResources(
  items: ConceptItem[],
  imageResources: Map<string, Uint8Array>,
  pdfResources: Map<string, Uint8Array>,
  warnings: string[],
): void {
  for (const item of items) {
    if (item.kind === "image") {
      item.data = findResource(imageResources, item.resourceId);
      if (!item.data) {
        warnings.push(`Image resource not found: ${item.resourceId}`);
      }
    } else if (item.kind === "pdf") {
      item.data = findResource(pdfResources, item.resourceId);
      if (!item.data) {
        warnings.push(`PDF resource not found: ${item.resourceId}`);
      }
    }
  }
}

function findResource(
  resources: Map<string, Uint8Array>,
  id: string,
): Uint8Array | null {
  const exact = resources.get(id);
  if (exact) {
    return exact;
  }
  for (const [key, data] of resources) {
    if (key.includes(id) || id.includes(key)) {
      return data;
    }
  }
  return null;
}

function findEntry(
  entries: Map<string, Uint8Array>,
  baseName: string,
): Uint8Array | undefined {
  const direct = entries.get(baseName);
  if (direct) {
    return direct;
  }
  for (const [name, data] of entries) {
    if (name === baseName || name.endsWith(`/${baseName}`)) {
      return data;
    }
  }
  return undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
