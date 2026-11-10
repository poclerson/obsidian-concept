# Concepts Viewer for Obsidian

Open and explore [Concepts](https://concepts.app/) app `.concept` drawings inside Obsidian.

`.concept` files are registered as a first-class Obsidian file type, so they appear in the file explorer and open in a dedicated, read-only canvas view instead of being treated as unknown files.

## Features

- Native Obsidian file explorer and quick switcher integration
- Pan and zoom with mouse, trackpad, touch, and keyboard
- Fit to content, 100%, and reset-to-saved-view controls
- Light, dark, paper, and checkerboard backgrounds
- Optional grid rendering
- Correct layer ordering, brush colors, brush widths, and eraser strokes
- Embedded image support with transforms and crops
- Text and PDF-page placeholders where full rendering is not yet available
- Instant thumbnail preview while a drawing is parsed
- PNG export and copy-to-clipboard
- Desktop and mobile support

This plugin is a read-only viewer. It never modifies the original `.concept` file.

## Installation

### From a release

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Put them in `<your-vault>/.obsidian/plugins/obsidian-concept/`.
3. Enable **Concepts Viewer** in **Settings → Community plugins**.

### From source

```bash
git clone https://github.com/poclerson/obsidian-concept.git
cd obsidian-concept
npm install
npm run build
```

Then copy or symlink `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder.

```bash
mkdir -p "<vault>/.obsidian/plugins/obsidian-concept"
ln -sf "$PWD/main.js" "<vault>/.obsidian/plugins/obsidian-concept/main.js"
ln -sf "$PWD/manifest.json" "<vault>/.obsidian/plugins/obsidian-concept/manifest.json"
ln -sf "$PWD/styles.css" "<vault>/.obsidian/plugins/obsidian-concept/styles.css"
```

If `.concept` files do not appear in the file explorer, enable **Settings → Files and links → Detect all extensions** and restart Obsidian once after installing the plugin.

## Development

```bash
npm install
npm run dev       # watch build
npm run build     # typecheck + production bundle
npm run check     # typecheck + unit tests
```

The plugin entry point is `src/main.ts`. The renderer is a Canvas 2D implementation and does not use Node-only APIs, so it works on Obsidian mobile.

## `.concept` file format

A `.concept` file is a ZIP archive containing:

- `Strokes.plist` — binary `NSKeyedArchiver` plist with layers, strokes, images, text, and PDF pages
- `Drawing.plist` — paper/background, grid, and saved viewport
- `Resources.plist` — imported resource mappings
- `Thumb.jpg` — embedded preview
- `metadata.plist` — document metadata
- `ImportedImages/` — embedded image resources

Stroke points are stored as 16-byte little-endian Float32 records. The viewer parses the archive in the browser with `fflate` and a small binary-plist parser.

## Credits

The format understanding and initial parsing approach were inspired by the MIT-licensed [concepts_reader](https://github.com/modulovalue/concepts_reader) project by modulovalue, which in turn credits [ConceptsAppiOSFileViewer](https://github.com/maxliebscher/ConceptsAppiOSFileViewer) by Max Liebscher.

Concepts is a trademark of TopHatch, Inc. This is an unofficial viewer and is not affiliated with Concepts or TopHatch.

## License

MIT
