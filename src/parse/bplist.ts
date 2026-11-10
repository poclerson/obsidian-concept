/**
 * Minimal binary plist (`bplist00`) reader.
 *
 * Apple's binary plist format is documented in `CFBinaryPList.c` and in the
 * open-source `bplist-parser` package. This implementation is self-contained so
 * it can run in Obsidian's renderer process without Node's `Buffer`.
 */

export class PlistUid {
  constructor(public readonly value: number) {}
}

export type PlistValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | Date
  | PlistUid
  | PlistValue[]
  | { [key: string]: PlistValue };

const HEADER = "bplist00";
const TRAILER_SIZE = 32;
const MAX_DEPTH = 256;

export class PlistParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlistParseError";
  }
}

export function parseBinaryPlist(input: ArrayBuffer | Uint8Array): PlistValue {
  const bytes = toBytes(input);
  if (bytes.byteLength < HEADER.length + TRAILER_SIZE) {
    throw new PlistParseError("Binary plist is too short");
  }

  const header = decodeAscii(bytes, 0, HEADER.length);
  if (header !== HEADER) {
    throw new PlistParseError(`Unsupported plist header: ${JSON.stringify(header)}`);
  }

  const trailerOffset = bytes.byteLength - TRAILER_SIZE;
  const offsetIntSize = bytes[trailerOffset + 6];
  const objectRefSize = bytes[trailerOffset + 7];
  const objectCount = readUnsigned(bytes, trailerOffset + 8, 8);
  const topObject = readUnsigned(bytes, trailerOffset + 16, 8);
  const offsetTableOffset = readUnsigned(bytes, trailerOffset + 24, 8);

  if (objectCount <= 0 || objectCount > 10_000_000) {
    throw new PlistParseError(`Unreasonable plist object count: ${objectCount}`);
  }
  if (objectRefSize < 1 || objectRefSize > 8) {
    throw new PlistParseError(`Invalid object reference size: ${objectRefSize}`);
  }
  if (offsetIntSize < 1 || offsetIntSize > 8) {
    throw new PlistParseError(`Invalid offset integer size: ${offsetIntSize}`);
  }

  const offsets = new Array<number>(objectCount);
  for (let index = 0; index < objectCount; index += 1) {
    offsets[index] = readUnsigned(
      bytes,
      offsetTableOffset + index * offsetIntSize,
      offsetIntSize,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cache = new Map<number, PlistValue>();
  const active = new Set<number>();

  const parseObject = (index: number, depth: number): PlistValue => {
    if (index < 0 || index >= objectCount) {
      throw new PlistParseError(`Object reference out of range: ${index}`);
    }
    if (cache.has(index)) {
      return cache.get(index) ?? null;
    }
    if (active.has(index)) {
      throw new PlistParseError(`Cyclic object reference at index ${index}`);
    }
    if (depth > MAX_DEPTH) {
      throw new PlistParseError("Binary plist is nested too deeply");
    }

    const offset = offsets[index];
    if (offset < 0 || offset >= bytes.byteLength) {
      throw new PlistParseError(`Object offset out of range: ${offset}`);
    }

    active.add(index);
    try {
      const result = parseAt(offset, index, depth);
      cache.set(index, result);
      return result;
    } finally {
      active.delete(index);
    }
  };

  const parseAt = (offset: number, index: number, depth: number): PlistValue => {
    const marker = bytes[offset];
    const type = marker >> 4;
    const info = marker & 0x0f;

    switch (type) {
      case 0x0:
        return parseSimple(info);
      case 0x1:
        return parseInteger(bytes, view, offset + 1, 1 << info);
      case 0x2:
        return parseReal(view, offset + 1, 1 << info);
      case 0x3: {
        const seconds = view.getFloat64(offset + 1, false);
        return new Date(Date.UTC(2001, 0, 1) + seconds * 1000);
      }
      case 0x4: {
        const { length, dataOffset } = readLength(info, offset + 1);
        return bytes.slice(dataOffset, dataOffset + length);
      }
      case 0x5: {
        const { length, dataOffset } = readLength(info, offset + 1);
        return decodeAscii(bytes, dataOffset, length);
      }
      case 0x6: {
        const { length, dataOffset } = readLength(info, offset + 1);
        return decodeUtf16Be(bytes, dataOffset, length);
      }
      case 0x7: {
        // Some newer plist writers use UTF-8 strings with marker 0x7.
        const { length, dataOffset } = readLength(info, offset + 1);
        return new TextDecoder("utf-8").decode(
          bytes.subarray(dataOffset, dataOffset + length),
        );
      }
      case 0x8:
        return new PlistUid(readUnsigned(bytes, offset + 1, info + 1));
      case 0xa:
      case 0xb:
      case 0xc: {
        const { length, dataOffset } = readLength(info, offset + 1);
        const result: PlistValue[] = [];
        cache.set(index, result);
        for (let i = 0; i < length; i += 1) {
          const ref = readUnsigned(
            bytes,
            dataOffset + i * objectRefSize,
            objectRefSize,
          );
          result.push(parseObject(ref, depth + 1));
        }
        return result;
      }
      case 0xd: {
        const { length, dataOffset } = readLength(info, offset + 1);
        const result: { [key: string]: PlistValue } = {};
        cache.set(index, result);
        for (let i = 0; i < length; i += 1) {
          const keyRef = readUnsigned(
            bytes,
            dataOffset + i * objectRefSize,
            objectRefSize,
          );
          const valueRef = readUnsigned(
            bytes,
            dataOffset + (length + i) * objectRefSize,
            objectRefSize,
          );
          const key = parseObject(keyRef, depth + 1);
          const value = parseObject(valueRef, depth + 1);
          if (typeof key === "string") {
            result[key] = value;
          }
        }
        return result;
      }
      default:
        throw new PlistParseError(`Unsupported plist marker type 0x${type.toString(16)}`);
    }
  };

  const readLength = (
    info: number,
    offset: number,
  ): { length: number; dataOffset: number } => {
    if (info !== 0x0f) {
      return { length: info, dataOffset: offset };
    }

    const marker = bytes[offset];
    if (marker >> 4 !== 0x1) {
      throw new PlistParseError("Plist length marker is not an integer");
    }
    const intSize = 1 << (marker & 0x0f);
    const length = readUnsigned(bytes, offset + 1, intSize);
    return { length, dataOffset: offset + 1 + intSize };
  };

  return parseObject(topObject, 0);
}

function parseSimple(info: number): PlistValue {
  switch (info) {
    case 0x0:
      return null;
    case 0x8:
      return false;
    case 0x9:
      return true;
    case 0xf:
      return null;
    default:
      return null;
  }
}

function parseInteger(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  size: number,
): number {
  switch (size) {
    case 1:
      return view.getInt8(offset);
    case 2:
      return view.getInt16(offset, false);
    case 4:
      return view.getInt32(offset, false);
    case 8: {
      const high = readUnsigned(bytes, offset, 4);
      const low = readUnsigned(bytes, offset + 4, 4);
      const signed = high >= 0x80000000 ? high - 0x100000000 : high;
      const value = signed * 0x100000000 + low;
      if (!Number.isSafeInteger(value)) {
        throw new PlistParseError("Integer exceeds safe range");
      }
      return value;
    }
    default: {
      // Rare non-power-of-two integers: read unsigned and sign-extend.
      const unsigned = readUnsigned(bytes, offset, size);
      const limit = 2 ** (size * 8 - 1);
      return unsigned >= limit ? unsigned - 2 ** (size * 8) : unsigned;
    }
  }
}

function parseReal(view: DataView, offset: number, size: number): number {
  if (size === 4) {
    return view.getFloat32(offset, false);
  }
  if (size === 8) {
    return view.getFloat64(offset, false);
  }
  throw new PlistParseError(`Unsupported real size: ${size}`);
}

function readUnsigned(bytes: Uint8Array, offset: number, size: number): number {
  if (size < 1 || size > 8) {
    throw new PlistParseError(`Invalid unsigned integer size: ${size}`);
  }
  if (offset < 0 || offset + size > bytes.byteLength) {
    throw new PlistParseError("Unexpected end of binary plist");
  }

  let value = 0;
  for (let i = 0; i < size; i += 1) {
    value = value * 256 + bytes[offset + i];
  }
  if (!Number.isSafeInteger(value)) {
    throw new PlistParseError("Binary plist integer exceeds safe range");
  }
  return value;
}

function decodeAscii(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  const end = offset + length;
  for (let i = offset; i < end; i += 1) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

function decodeUtf16Be(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const high = bytes[offset + i * 2];
    const low = bytes[offset + i * 2 + 1];
    result += String.fromCharCode((high << 8) | low);
  }
  return result;
}

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  return new Uint8Array(input);
}

export function isPlistUid(value: unknown): value is PlistUid {
  return value instanceof PlistUid;
}

export function deref(
  objects: PlistValue[],
  value: PlistValue | undefined,
): PlistValue | null {
  if (value === undefined) {
    return null;
  }
  if (value instanceof PlistUid) {
    return objects[value.value] ?? null;
  }
  return value;
}

export function asDict(
  value: PlistValue | null | undefined,
): { [key: string]: PlistValue } | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (value instanceof Uint8Array || value instanceof Date || value instanceof PlistUid) {
    return null;
  }
  return value as { [key: string]: PlistValue };
}

export function asArray(value: PlistValue | null | undefined): PlistValue[] | null {
  return Array.isArray(value) ? value : null;
}

export function asData(value: PlistValue | null | undefined): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

export function asString(value: PlistValue | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: PlistValue | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: PlistValue | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Reads an `NSArray`/`NSMutableArray` wrapper (`{ "NS.objects": [...] }`). */
export function readNsArray(
  objects: PlistValue[],
  value: PlistValue | undefined,
): PlistValue[] {
  const dereferenced = deref(objects, value);
  if (Array.isArray(dereferenced)) {
    return dereferenced;
  }
  const dict = asDict(dereferenced);
  const array = dict ? asArray(dict["NS.objects"]) : null;
  return array ?? [];
}
