import { describe, expect, it } from "vitest";
import {
  applyMat4,
  mat4Scale,
  parseMat4,
} from "../src/parse/transform";

function matrixBytes(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return new Uint8Array(buffer);
}

describe("transform helpers", () => {
  it("parses row-major float32 matrices", () => {
    const mat = parseMat4(
      matrixBytes([
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 1, 0,
        10, 20, 0, 1,
      ]),
    );

    expect(mat).not.toBeNull();
    expect(applyMat4(mat, 5, 7)).toEqual({ x: 20, y: 41 });
    expect(mat4Scale(mat)).toBeCloseTo(Math.sqrt(6));
  });

  it("returns null for incomplete matrix data", () => {
    expect(parseMat4(new Uint8Array(16))).toBeNull();
  });
});
