#!/usr/bin/env python3
"""Generate the tiny synthetic .concept fixture used by the unit tests.

The fixture is intentionally hand-built so tests do not depend on any private
Concepts document. It contains one layer, one red stroke, a paper background,
and a saved viewport.
"""

from __future__ import annotations

import plistlib
import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "minimal.concept"


def uid(index: int) -> plistlib.UID:
    return plistlib.UID(index)


def archive(objects: list[object], root_index: int) -> dict[str, object]:
    return {
        "$archiver": "THFormatObjCEncoder",
        "$objects": objects,
        "$top": {"root": uid(root_index)},
        "$version": 100000,
    }


def class_object(name: str, parents: list[str]) -> dict[str, object]:
    return {
        "$classes": [name, *parents],
        "$classname": name,
    }


def make_strokes_plist() -> dict[str, object]:
    points = b""
    for x, y, pressure, angle in [
        (10.0, 20.0, 0.5, 0.0),
        (30.0, 40.0, 0.8, 0.0),
    ]:
        points += struct.pack("<ffff", x, y, pressure, angle)

    identity = struct.pack("<16f", *([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))

    objects: list[object] = [
        "$null",
        {
            "$class": uid(11),
            "gridExists": False,
            "rootGroupLayers": uid(2),
            "diIdentifier": "root",
        },
        {
            "$class": uid(12),
            "NS.objects": [uid(3)],
        },
        {
            "$class": uid(12),
            "diIdentifier": "layer-1",
            "name": "Layer 1",
            "groupItems": uid(4),
        },
        {
            "$class": uid(11),
            "NS.objects": [uid(5)],
        },
        {
            "$class": uid(13),
            "diIdentifier": "stroke-1",
            "strokePointsNonOptionalAngles": uid(6),
            "diSavedTransform": uid(7),
            "brushProperties": uid(8),
            "containsPressure": True,
        },
        points,
        identity,
        {
            "$class": uid(14),
            "brushToolNew": 1,
            "brushWidth": 2.0,
            "brushAlpha": 1.0,
            "brushColor": uid(9),
        },
        {
            "$class": uid(15),
            "UIRed": 1.0,
            "UIGreen": 0.0,
            "UIBlue": 0.0,
            "UIAlpha": 1.0,
        },
        class_object("StrokeManager", ["NSObject"]),
        class_object("NSMutableArray", ["NSArray", "NSObject"]),
        class_object("DrawingItemGroup", ["DrawingItem", "NSObject"]),
        class_object("Stroke", ["DrawingItem", "NSObject"]),
        class_object("BrushProperties", ["NSObject"]),
        class_object("UIColor", ["NSObject"]),
    ]

    return archive(objects, 1)


def make_drawing_plist() -> dict[str, object]:
    objects: list[object] = [
        "$null",
        {
            "$class": uid(9),
            "canvasState": uid(2),
            "grid": uid(6),
        },
        {
            "$class": uid(10),
            "transform": uid(3),
            "backgroundSettings": uid(4),
        },
        {
            "$class": uid(11),
            "savedTransform": "[1, 0, 0, 1, -100, -50]",
            "worldOriginAtCenter": True,
        },
        {
            "$class": uid(12),
            "drawingBackgroundColor": uid(5),
            "drawingBackground": 3,
        },
        {
            "$class": uid(13),
            "UIRed": 0.976,
            "UIGreen": 0.976,
            "UIBlue": 0.945,
            "UIAlpha": 1.0,
        },
        {
            "$class": uid(14),
            "enabled": True,
            "customGridProperties": uid(7),
        },
        {
            "$class": uid(15),
            "majorSpacing": struct.pack("<ff", 50.0, 50.0),
            "color": uid(8),
            "alphaMajor": 56,
        },
        {
            "$class": uid(13),
            "UIRed": 0.28,
            "UIGreen": 0.55,
            "UIBlue": 0.78,
            "UIAlpha": 1.0,
        },
        class_object("Drawing", ["NSObject"]),
        class_object("CanvasState", ["NSObject"]),
        class_object("CanvasTransform", ["NSObject"]),
        class_object("BackgroundSettings", ["NSObject"]),
        class_object("UIColor", ["NSObject"]),
        class_object("Grid", ["NSObject"]),
        class_object("GridProperties", ["NSObject"]),
    ]

    return archive(objects, 1)


def main() -> None:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(FIXTURE, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("Strokes.plist", plistlib.dumps(make_strokes_plist(), fmt=plistlib.FMT_BINARY))
        zf.writestr("Drawing.plist", plistlib.dumps(make_drawing_plist(), fmt=plistlib.FMT_BINARY))
        zf.writestr("metadata.plist", plistlib.dumps({}, fmt=plistlib.FMT_BINARY))
    print(f"Wrote {FIXTURE}")


if __name__ == "__main__":
    main()
