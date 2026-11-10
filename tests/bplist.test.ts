import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PlistUid,
  asArray,
  asDict,
  parseBinaryPlist,
} from "../src/parse/bplist";
import { readConceptArchive } from "../src/parse/zip";

const fixture = readFileSync(new URL("./fixtures/minimal.concept", import.meta.url));

describe("parseBinaryPlist", () => {
  it("parses an NSKeyedArchiver binary plist", () => {
    const archive = readConceptArchive(fixture);
    const strokes = archive.entries.get("Strokes.plist");
    expect(strokes).toBeDefined();

    const plist = parseBinaryPlist(strokes as Uint8Array);
    const dict = asDict(plist);
    expect(dict?.["$archiver"]).toBe("THFormatObjCEncoder");

    const objects = asArray(dict?.["$objects"]);
    expect(objects).not.toBeNull();
    expect(objects?.[0]).toBe("$null");
    expect(objects?.[1]).not.toBeInstanceOf(PlistUid);
    expect(objects?.[2]).not.toBeInstanceOf(PlistUid);
    const root = asDict(objects?.[1] ?? null);
    expect(root?.["rootGroupLayers"]).toBeInstanceOf(PlistUid);
  });

  it("rejects non-plist data with a useful error", () => {
    expect(() => parseBinaryPlist(new Uint8Array(64))).toThrow(
      /Unsupported plist header/,
    );
  });
});
