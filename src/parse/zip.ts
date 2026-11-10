import { unzipSync } from "fflate";

const MAX_ENTRIES = 2_000;
const MAX_SINGLE_UNCOMPRESSED = 128 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024;

const CORE_FILES = new Set([
  "Strokes.plist",
  "Drawing.plist",
  "Resources.plist",
  "Thumb.jpg",
  "metadata.plist",
]);

export class ConceptArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConceptArchiveError";
  }
}

export interface ConceptArchive {
  entries: Map<string, Uint8Array>;
  compressedSize: number;
  uncompressedSize: number;
}

/**
 * Unpacks a `.concept` file. Only files relevant to the viewer are
 * decompressed, and archive-size limits protect against malicious zip bombs.
 */
export function readConceptArchive(input: ArrayBuffer | Uint8Array): ConceptArchive {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let entryCount = 0;
  let uncompressedSize = 0;

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        if (entryCount > MAX_ENTRIES) {
          throw new ConceptArchiveError("Archive has too many entries");
        }
        if (!isRelevantEntry(file.name)) {
          return false;
        }
        if (file.originalSize > MAX_SINGLE_UNCOMPRESSED) {
          throw new ConceptArchiveError(
            `Archive entry is too large: ${file.name}`,
          );
        }
        uncompressedSize += file.originalSize;
        if (uncompressedSize > MAX_TOTAL_UNCOMPRESSED) {
          throw new ConceptArchiveError("Archive is too large when unpacked");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ConceptArchiveError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ConceptArchiveError(`Could not read .concept archive: ${message}`);
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(unzipped)) {
    entries.set(name, data);
  }

  return {
    entries,
    compressedSize: bytes.byteLength,
    uncompressedSize,
  };
}

function isRelevantEntry(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  if (CORE_FILES.has(base)) {
    return true;
  }
  if (name.startsWith("ImportedImages/")) {
    return true;
  }
  return /\.(pdf|png|jpe?g|webp|gif|svg)$/i.test(name);
}
