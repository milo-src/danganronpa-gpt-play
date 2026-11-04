"""Verify catalog references, decoded images and downloaded SHA-256 checksums offline."""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    characters = read(ROOT / 'src/data/characters.json')['characters']
    ids = set()
    paths = set()
    total_bytes = 0
    transparent = 0
    for character in characters:
        assert character['id'] not in ids, 'Duplicate character ID'
        ids.add(character['id'])
        manifest_path = PUBLIC / character['manifest']
        manifest = read(manifest_path)
        assert manifest['id'] == character['id'], str(manifest_path)
        assert manifest['defaultSprite'] in manifest['sprites'], str(manifest_path)
        sources = read(manifest_path.parent / 'sources.json')['images']
        by_path = {entry['path']: entry for entry in sources}
        assert len(by_path) == len(sources) == len(manifest['sprites']) == character['spriteCount']
        assert set(by_path) == set(manifest['sprites'].values())
        for relative in manifest['sprites'].values():
            path = (PUBLIC / relative).resolve()
            assert path.is_relative_to(PUBLIC.resolve()), relative
            assert path.is_file(), relative
            data = path.read_bytes()
            assert hashlib.sha256(data).hexdigest() == by_path[relative]['sha256'], relative
            with Image.open(path) as image:
                assert (image.width, image.height) == (by_path[relative]['width'], by_path[relative]['height']), relative
                assert image.format == by_path[relative]['format'], relative
                image.verify()
            if by_path[relative].get('rgbaSha256'):
                with Image.open(path) as image:
                    assert hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest() == by_path[relative]['rgbaSha256'], relative
            assert relative not in paths, relative
            paths.add(relative)
            total_bytes += len(data)
            transparent += int(by_path[relative]['transparent'])
    all_images = {p.relative_to(PUBLIC).as_posix() for p in (PUBLIC / 'assets/characters').rglob('*')
                  if p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.gif')}
    assert paths == all_images, f'Unindexed or missing images: {all_images ^ paths}'
    assert not list((PUBLIC / 'assets/characters').rglob('*.part')), 'Incomplete downloads remain'
    # Import journals must describe the same files as the runtime manifests.
    ledger_records = []
    cache = ROOT / 'source-assets/import'
    for filename in ('bucket-images.json', 'v3-images.json', 'supplement-images.json'):
        if (cache / filename).exists():
            ledger_records.extend(read(cache / filename))
    if (cache / 'web-images.jsonl').exists():
        ledger_records.extend(json.loads(line) for line in (cache / 'web-images.jsonl').read_text(encoding='utf-8').splitlines())
    assert {r['path'] for r in ledger_records} == paths, 'Import journals differ from catalog'
    for entry in ledger_records:
        assert hashlib.sha256((PUBLIC / entry['path']).read_bytes()).hexdigest() == entry['sha256'], entry['path']
    report = dict(status='passed', characters=len(ids), images=len(paths), bytes=total_bytes,
                  transparentImages=transparent, brokenReferences=0, checksumFailures=0)
    (ROOT / 'source-assets/import/verification.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
