"""Verify local background files, catalogs, checksums and lossless pixel hashes."""
import hashlib
import json
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    catalog = read(ROOT / 'src/data/backgrounds.json')
    entries = catalog['backgrounds']
    assert len({r['id'] for r in entries}) == len(entries), 'Duplicate IDs'
    paths = {r['path'] for r in entries}
    assert len(paths) == len(entries), 'Duplicate paths'
    browser = (PUBLIC / 'assets/backgrounds/catalog.js').read_text(encoding='utf-8')
    assert browser.startswith('window.backgroundCatalog = ')
    assert json.loads(browser.removeprefix('window.backgroundCatalog = ').strip().removesuffix(';')) == catalog
    sources = []
    for manifest in (PUBLIC / 'assets/backgrounds').glob('*/sources.json'):
        sources.extend(read(manifest)['images'])
    by_path = {r['path']: r for r in sources}
    assert len(by_path) == len(sources) == len(entries)
    assert set(by_path) == paths, 'Sources differ from runtime catalog'
    total_bytes = 0
    for entry in entries:
        relative = entry['path']
        source = by_path[relative]
        assert all(source[k] == v for k, v in entry.items()), relative
        assert not source.get('copyrightNotice'), relative
        assert source['origin'] == 'community-game-background-collection', relative
        path = (PUBLIC / relative).resolve()
        assert path.is_relative_to((PUBLIC / 'assets/backgrounds').resolve()), relative
        data = path.read_bytes()
        assert len(data) == source['bytes'], relative
        assert hashlib.sha256(data).hexdigest() == source['sha256'], relative
        with Image.open(path) as image:
            assert image.size == (entry['width'], entry['height']), relative
            assert hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest() == source['rgbaSha256'], relative
        total_bytes += len(data)
    files = {p.relative_to(PUBLIC).as_posix()
             for p in (PUBLIC / 'assets/backgrounds').rglob('*')
             if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp', '.gif')}
    assert files == paths, f'Unindexed or missing images: {files ^ paths}'
    counts = dict(Counter(r['game'] for r in entries))
    for game, count in counts.items():
        assert catalog['coverage'][game]['images'] == count
    report = read(ROOT / 'source-assets/backgrounds/import-report.json')
    assert report['images'] == len(entries) and report['bytes'] == total_bytes
    assert report['coverage'] == catalog['coverage']
    result = dict(status='passed', images=len(entries), bytes=total_bytes,
                  byGame=counts, brokenReferences=0, checksumFailures=0,
                  pixelHashFailures=0)
    (ROOT / 'source-assets/backgrounds/verification.json').write_text(
        json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
