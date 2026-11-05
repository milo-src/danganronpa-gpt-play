"""Measure transparent padding for rendering; never modify original sprites."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
characters = json.loads((ROOT / 'src/data/characters.json').read_text(encoding='utf-8'))['characters']
bounds = {}
for entry in characters:
    manifest = json.loads((ROOT / 'public' / entry['manifest']).read_text(encoding='utf-8'))
    measured = {}
    for key, relative in manifest['sprites'].items():
        with Image.open(ROOT / 'public' / relative) as source:
            rgba = source.convert('RGBA')
            box = rgba.getchannel('A').getbbox() or (0, 0, rgba.width, rgba.height)
            x, y, right, bottom = box
            measured[key] = [rgba.width, rgba.height, x, y, right - x, bottom - y]
    bounds[entry['id']] = measured
(ROOT / 'src/data/sprite-bounds.json').write_text(json.dumps(bounds, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Measured {sum(map(len, bounds.values()))} sprites; originals unchanged.')
