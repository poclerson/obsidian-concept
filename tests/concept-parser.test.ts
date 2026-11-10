import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConceptFile } from "../src/parse/concept-parser";

const fixture = readFileSync(new URL("./fixtures/minimal.concept", import.meta.url));

describe("parseConceptFile", () => {
  it("parses a minimal .concept archive", () => {
    const document = parseConceptFile(fixture, "minimal.concept");

    expect(document.name).toBe("minimal");
    expect(document.stats.strokeCount).toBe(1);
    expect(document.stats.totalPoints).toBe(2);
    expect(document.warnings).toEqual([]);
  });

  it("reconstructs the layer tree and painting order", () => {
    const document = parseConceptFile(fixture, "minimal.concept");

    expect(document.layers).toHaveLength(1);
    expect(document.layers[0].name).toBe("Layer 1");
    expect(document.layers[0].children).toHaveLength(1);
    expect(document.layers[0].children[0].kind).toBe("item");
    expect(document.items).toHaveLength(1);
    expect(document.items[0].kind).toBe("stroke");
  });

  it("decodes stroke points, brush properties, and bounds", () => {
    const document = parseConceptFile(fixture, "minimal.concept");
    const item = document.items[0];
    if (item.kind !== "stroke") {
      throw new Error("expected a stroke");
    }

    expect(item.points).toHaveLength(2);
    expect(item.points[0]).toMatchObject({ x: 10, y: 20 });
    expect(item.points[1]).toMatchObject({ x: 30, y: 40 });
    expect(item.width).toBeCloseTo(2);
    expect(item.color).toMatchObject({ r: 1, g: 0, b: 0, a: 1 });
    expect(item.opacity).toBe(1);
    expect(item.bounds.x).toBeCloseTo(9);
    expect(item.bounds.y).toBeCloseTo(19);
    expect(item.bounds.width).toBeCloseTo(22);
    expect(item.bounds.height).toBeCloseTo(22);
  });

  it("reads the document background, grid, and saved viewport", () => {
    const document = parseConceptFile(fixture, "minimal.concept");

    expect(document.background.r).toBeCloseTo(0.976);
    expect(document.background.g).toBeCloseTo(0.976);
    expect(document.background.b).toBeCloseTo(0.945);
    expect(document.grid).toMatchObject({ enabled: true, spacing: 50 });
    expect(document.canvasView).toMatchObject({
      scale: 1,
      tx: -100,
      ty: -50,
    });
  });
});
