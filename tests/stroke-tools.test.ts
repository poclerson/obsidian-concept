import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConceptFile } from "../src/parse/concept-parser";

const fixture = readFileSync(
  new URL("./fixtures/features.concept", import.meta.url),
);

function load() {
  return parseConceptFile(fixture, "features.concept");
}

describe("brush tools", () => {
  it("keeps brushWidth in world units instead of scaling it by the transform", () => {
    const document = load();
    const pen = document.items.find((item) => item.id === "pen");
    if (pen?.kind !== "stroke") {
      throw new Error("expected the pen stroke");
    }

    expect(pen.width).toBe(2);
    expect(pen.points[0]).toMatchObject({ x: 30, y: 60 });
    expect(pen.points[1]).toMatchObject({ x: 70, y: 100 });
  });

  it("marks mask tools instead of painting them as black ink", () => {
    const document = load();
    const mask = document.items.find((item) => item.id === "mask");
    if (mask?.kind !== "stroke") {
      throw new Error("expected the mask stroke");
    }

    expect(mask.brushTool).toBe(0);
    expect(mask.isMask).toBe(true);
    expect(mask.isFill).toBe(false);
  });

  it("parses fill strokes as closed colour shapes without a width", () => {
    const document = load();
    const fill = document.items.find((item) => item.id === "fill");
    if (fill?.kind !== "stroke") {
      throw new Error("expected the fill stroke");
    }

    expect(fill.brushTool).toBe(11);
    expect(fill.isFill).toBe(true);
    expect(fill.closed).toBe(true);
    expect(fill.width).toBe(0);
    expect(fill.color).toMatchObject({ r: 0.2, g: 0.8, b: 0.3, a: 1 });
  });

  it("honours layer visibility and opacity", () => {
    const document = load();

    expect(document.layers.map((layer) => layer.name)).toEqual([
      "Ink",
      "Hidden",
    ]);
    expect(document.layers[1].visible).toBe(false);
    expect(document.layers[1].opacity).toBe(0.5);
    expect(document.items.map((item) => item.id)).toEqual([
      "pen",
      "mask",
      "fill",
    ]);
  });
});
