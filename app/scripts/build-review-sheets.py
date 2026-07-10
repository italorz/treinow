import json
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "catalog" / "exercises.pt-BR.json").read_text(encoding="utf-8"))
OUT = ROOT / "tmp" / "exercise-review"
FRAMES = OUT / "frames"
OUT.mkdir(parents=True, exist_ok=True)
FRAMES.mkdir(parents=True, exist_ok=True)

def family(name: str) -> str:
    return (name.lower()
            .replace(".mov_begin", "")
            .replace(".mov_loop", "")
            .replace("_begin", "")
            .replace("_loop", ""))

ambiguous = [item for item in CATALOG if item["needsReview"]]
families: dict[str, dict] = {}
for item in ambiguous:
    key = family(item["nameRaw"])
    current = families.get(key)
    if current is None or "loop" in item["video"]["fileName"].lower():
        families[key] = item

items = list(families.values())
font = ImageFont.load_default()
tile_w, tile_h = 720, 205
frame_w, frame_h = 230, 170
per_sheet = 12

for index, item in enumerate(items):
    source = ROOT / "videos" / item["video"]["fileName"]
    duration = max(0.2, float(item["video"].get("durationSeconds") or 1))
    images = []
    for position, fraction in enumerate((0.15, 0.5, 0.85)):
        target = FRAMES / f"{index:03d}-{position}.jpg"
        subprocess.run([
            "ffmpeg", "-loglevel", "error", "-y", "-ss", str(duration * fraction),
            "-i", str(source), "-frames:v", "1", "-vf",
            f"scale={frame_w}:{frame_h}:force_original_aspect_ratio=decrease,pad={frame_w}:{frame_h}:(ow-iw)/2:(oh-ih)/2:black",
            str(target)
        ], check=True)
        images.append(Image.open(target).convert("RGB"))

    tile = Image.new("RGB", (tile_w, tile_h), "#101522")
    draw = ImageDraw.Draw(tile)
    draw.text((8, 5), f"{index:02d} | {item['nameRaw'][:88]}", fill="white", font=font)
    for position, image in enumerate(images):
        tile.paste(image, (5 + position * 237, 28))
    item["_tile"] = tile

for sheet_index in range(math.ceil(len(items) / per_sheet)):
    chunk = items[sheet_index * per_sheet:(sheet_index + 1) * per_sheet]
    sheet = Image.new("RGB", (tile_w * 2, tile_h * 6), "#080b12")
    for offset, item in enumerate(chunk):
        sheet.paste(item["_tile"], ((offset % 2) * tile_w, (offset // 2) * tile_h))
    sheet.save(OUT / f"sheet-{sheet_index + 1}.jpg", quality=92)

manifest = [{"index": i, "nameRaw": item["nameRaw"], "fileName": item["video"]["fileName"]} for i, item in enumerate(items)]
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"{len(items)} famílias ambíguas em {math.ceil(len(items) / per_sheet)} pranchas: {OUT}")
