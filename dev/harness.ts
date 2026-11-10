import { parseConceptFile } from "../src/parse/concept-parser";
import { ConceptRenderer, type BackgroundMode } from "../src/render/renderer";

const host = document.getElementById("host") as HTMLElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const renderer = new ConceptRenderer(canvas, {
  backgroundMode: "paper",
  showGrid: false,
});

const backgrounds: BackgroundMode[] = ["paper", "light", "dark", "checker"];

function resize(): void {
  const rect = host.getBoundingClientRect();
  renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  updateStatus();
}

function updateStatus(): void {
  const doc = renderer.document;
  status.textContent = doc
    ? `${doc.stats.strokeCount} strokes · ${doc.stats.totalPoints} points · ${renderer.zoomPercent}% · ${renderer.paintOptions.backgroundMode}`
    : "No document loaded";
}

async function loadBuffer(buffer: ArrayBuffer, name: string): Promise<void> {
  try {
    const doc = parseConceptFile(buffer, name);
    renderer.setDocument(doc, "fit");
    renderer.render();
    updateStatus();
    console.info("Loaded concept", doc.stats, doc.bounds, doc.warnings);
  } catch (error) {
    console.error(error);
    status.textContent = `Failed to load: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function loadUrl(url: string): void {
  void fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => loadBuffer(buffer, url.split("/").pop() ?? "drawing.concept"))
    .catch((error) => {
      console.error(error);
      status.textContent = `Failed to fetch: ${error instanceof Error ? error.message : String(error)}`;
    });
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void file.arrayBuffer().then((buffer) => loadBuffer(buffer, file.name));
});

document.getElementById("fit")?.addEventListener("click", () => {
  renderer.fitToContent();
  updateStatus();
});
document.getElementById("saved")?.addEventListener("click", () => {
  renderer.resetView();
  updateStatus();
});
document.getElementById("zoom-in")?.addEventListener("click", () => {
  renderer.zoomBy(1.25);
  updateStatus();
});
document.getElementById("zoom-out")?.addEventListener("click", () => {
  renderer.zoomBy(0.8);
  updateStatus();
});
document.getElementById("background")?.addEventListener("click", () => {
  const current = backgrounds.indexOf(renderer.paintOptions.backgroundMode);
  renderer.setOptions({ backgroundMode: backgrounds[(current + 1) % backgrounds.length] });
  updateStatus();
});
document.getElementById("grid")?.addEventListener("click", () => {
  renderer.setOptions({ showGrid: !renderer.paintOptions.showGrid });
  updateStatus();
});

renderer.onRender = updateStatus;
window.addEventListener("resize", resize);
resize();

const params = new URLSearchParams(window.location.search);
const file = params.get("file");
if (file) {
  loadUrl(file);
}

declare global {
  interface Window {
    __conceptRenderer: ConceptRenderer;
  }
}
window.__conceptRenderer = renderer;
