import { describe, expect, it } from "vitest";
import { Viewport } from "../src/render/viewport";

describe("Viewport", () => {
  it("fits content and maps between screen and world coordinates", () => {
    const viewport = new Viewport();
    viewport.setSize(1000, 800);
    viewport.fit({ x: 0, y: 0, width: 100, height: 50 }, 0);

    expect(viewport.scale).toBe(10);
    expect(viewport.tx).toBe(0);
    expect(viewport.ty).toBe(150);
    expect(viewport.worldToScreen(50, 25)).toEqual({ x: 500, y: 400 });
    expect(viewport.screenToWorld(500, 400)).toEqual({ x: 50, y: 25 });
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const viewport = new Viewport();
    viewport.setSize(800, 600);
    viewport.scale = 2;
    viewport.tx = 100;
    viewport.ty = 50;

    const before = viewport.screenToWorld(400, 300);
    viewport.zoomAt(400, 300, 2);
    const after = viewport.screenToWorld(400, 300);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(viewport.scale).toBe(4);
  });

  it("resets to the saved Concepts viewport", () => {
    const viewport = new Viewport();
    viewport.setSize(1000, 800);
    viewport.resetToSaved({
      scale: 2,
      tx: -100,
      ty: -50,
      raw: "[2, 0, 0, 2, -100, -50]",
    });

    expect(viewport.scale).toBe(2);
    expect(viewport.tx).toBe(300);
    expect(viewport.ty).toBe(300);
  });

  it("maps an exact export rect to the canvas", () => {
    const viewport = new Viewport();
    viewport.setExact({ x: 10, y: 20, width: 100, height: 50 }, 2);

    expect(viewport.width).toBe(200);
    expect(viewport.height).toBe(100);
    expect(viewport.worldToScreen(10, 70)).toEqual({ x: 0, y: 0 });
    expect(viewport.worldToScreen(110, 20)).toEqual({ x: 200, y: 100 });
  });
});
