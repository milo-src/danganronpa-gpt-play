"""Import downloaded packs and the pinned public sprite index; never execute pack contents."""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import threading
from urllib.parse import urlsplit
import zipfile

import requests
from PIL import Image
from sprite_codec import compact_image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
CACHE = ROOT / 'source-assets' / 'import'
REPO = 'https://github.com/Wh1teZz/danganronpa_sprite_bucket'
COMMIT = 'b4c448c3453a449013024ef07141999b1351e971'
BUCKET = ROOT / 'source-assets/downloads/dr1-dr2-sprite-bucket.zip'
ROSTER = {}


def group(game, pairs):
    for alias, name in pairs.items():
        ROSTER[alias] = (game, name)


group('dr1', dict(aoi='Aoi Asahina', alterego='Alter Ego', byakuya='Byakuya Togami',
    celes='Celestia Ludenberg', chihiro='Chihiro Fujisaki', hifumi='Hifumi Yamada',
    junko='Junko Enoshima', junkosaba='Mukuro Ikusaba', mukuro='Mukuro Ikusaba',
    kiyotaka='Kiyotaka Ishimaru', ishida='Kiyotaka Ishimaru', kyouko='Kyoko Kirigiri',
    leon='Leon Kuwata', makoto='Makoto Naegi', mondo='Mondo Owada', monokuma='Monokuma',
    sakura='Sakura Ogami', sayaka='Sayaka Maizono', touko='Toko Fukawa', yasuhiro='Yasuhiro Hagakure'))
group('dr2', dict(akane='Akane Owari', chiaki='Chiaki Nanami', fuyuhiko='Fuyuhiko Kuzuryu',
    fuyuhiko_nopatch='Fuyuhiko Kuzuryu', gundham='Gundham Tanaka', hajime='Hajime Hinata',
    hajime_saiyan='Hajime Hinata', hiyoko='Hiyoko Saionji', ibuki='Ibuki Mioda',
    imposter='Ultimate Imposter', kazuichi='Kazuichi Soda', mahiru='Mahiru Koizumi',
    mechamaru='Nekomaru Nidai', mikan='Mikan Tsumiki', monomi='Monomi', nagito='Nagito Komaeda',
    nekomaru='Nekomaru Nidai', peko='Peko Pekoyama', sonia='Sonia Nevermind',
    teruteru='Teruteru Hanamura', usami='Usami'))
group('udg', dict(jatarou='Jataro Kemuri', komaru='Komaru Naegi',
    **{'komaru-bracelet':'Komaru Naegi'}, kotoko='Kotoko Utsugi', kurokuma='Kurokuma',
    masaru='Masaru Daimon', monaka='Monaca Towa', nagisa='Nagisa Shingetsu',
    shirokuma='Shirokuma', yuuta='Yuta Asahina'))
group('drv3', dict(angie='Angie Yonaga', gonta='Gonta Gokuhara', himiko='Himiko Yumeno',
    keebo='K1-B0', kaede='Kaede Akamatsu', kaito='Kaito Momota', kirumi='Kirumi Tojo',
    kokichi='Kokichi Oma', korekiyo='Korekiyo Shinguji', maki='Maki Harukawa', miu='Miu Iruma',
    rantaro='Rantaro Amami', ryoma='Ryoma Hoshi', shuichi='Shuichi Saihara',
    tenko='Tenko Chabashira', tsumugi='Tsumugi Shirogane', monodam='Monodam',
    monokid='Monokid', monophanie='Monophanie', monosuke='Monosuke', monotaro='Monotaro'))
group('custom', dict(natsumi='Natsumi Kuzuryu', ryouko='Ryoko Otonashi', yasuke='Yasuke Matsuda',
    kyouko_mirai='Kyoko Kirigiri DR3', yasuhiro_mirai='Yasuhiro Hagakure DR3',
    mukuro_mirai='Mukuro Ikusaba DR3', kyousuke_mirai='Kyosuke Munakata',
    ruruka_mirai='Ruruka Ando', miaya_mirai='Miaya Gekkogahara', makoto_mirai='Makoto Naegi DR3',
    juuzo_mirai='Juzo Sakakura', aoi_mirai='Aoi Asahina DR3', daisaku_mirai='Daisaku Bandai',
    kazuo_mirai='Kazuo Tengan', gozu_mirai='Great Gozu', kouichi_mirai='Koichi Kizakura',
    sounosuke_mirai='Sonosuke Izayoi', seiko_mirai='Seiko Kimura'))


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def image_info(data):
    with Image.open(io.BytesIO(data)) as im:
        im.verify()
    with Image.open(io.BytesIO(data)) as im:
        im.load()
        alpha = im.convert('RGBA').getchannel('A').getextrema()
        return dict(width=im.width, height=im.height, format=im.format,
                    transparent=alpha[0] < 255, sha256=hashlib.sha256(data).hexdigest())


def save_image(game, name, key, data, source):
    data, encoding = compact_image(data)
    info = image_info(data)
    ext = {'PNG': '.png', 'JPEG': '.jpg', 'GIF': '.gif', 'WEBP': '.webp'}[info['format']]
    relative = Path('assets/characters') / game / slug(name) / 'sprites' / (key + ext)
    target = PUBLIC / relative
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != info['sha256']:
        raise ValueError(f'Refusing to overwrite different image: {relative}')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        partial = target.with_suffix(target.suffix + '.part')
        partial.write_bytes(data)
        partial.replace(target)
    return dict(game=game, name=name, key=key, path=relative.as_posix(), **info, **source, **encoding)


def load_index():
    saved = CACHE / 'source-index.json'
    if saved.exists():
        return json.loads(saved.read_text(encoding='utf-8'))
    with zipfile.ZipFile(BUCKET) as archive:
        index = json.loads(archive.read(next(n for n in archive.namelist() if n.endswith('/busts.json'))))
    write_json(CACHE / 'source-index.json', index)
    return index


def import_web():
    index = load_index()
    log = CACHE / 'web-images.jsonl'
    previous = [json.loads(x) for x in log.read_text(encoding='utf-8').splitlines()] if log.exists() else []
    done = {(x['alias'], x['index']) for x in previous if (PUBLIC / x['path']).exists()}
    jobs = [(a, i, entry) for a, entries in index.items() for i, entry in enumerate(entries)
            if (a, i) not in done]
    failures = []
    blocked = set()
    lock = threading.Lock()
    local = threading.local()

    def download(job):
        alias, i, entry = job
        url = (entry if isinstance(entry, str) else entry['src']).split('#')[0]
        host = urlsplit(url).netloc
        if host in blocked:
            return dict(alias=alias, index=i, url=url, error='Host returned access/rate limit error earlier')
        if not hasattr(local, 'session'):
            local.session = requests.Session()
        try:
            response = local.session.get(url, timeout=(10, 25))
            if response.status_code in (403, 429):
                with lock:
                    blocked.add(host)
            response.raise_for_status()
            if 'image/' not in response.headers.get('Content-Type', ''):
                raise ValueError('Response is not an image')
            if 'removed' in response.url.lower():
                raise ValueError('Source redirects to removed-image placeholder')
            game, name = ROSTER[alias]
            if alias == 'touko' and (22 <= i <= 33 or 58 <= i <= 66):
                name = 'Genocide Jack'
            key = f'archive/{slug(alias)}-{i+1:03d}'
            status = 'community-or-unverified'
            if isinstance(entry, dict) and entry.get('is-original') is False:
                status = 'fan-edit'
            elif game == 'custom':
                status = 'fan-or-anime-adaptation'
            result = save_image(game, name, key, response.content,
                                dict(source=url, sourceIndex=REPO + '/blob/' + COMMIT + '/busts.json',
                                     origin=status, alias=alias, index=i))
            return result
        except Exception as exc:
            # Do not store transient signed URLs or full HTTP response bodies.
            return dict(alias=alias, index=i, url=url, error=str(exc).split(' for url:')[0])

    with log.open('a', encoding='utf-8') as stream, concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for n, result in enumerate(pool.map(download, jobs), 1):
            if 'error' in result:
                failures.append(result)
            else:
                stream.write(json.dumps(result, ensure_ascii=False) + '\n')
                stream.flush()
            if n % 100 == 0 or n == len(jobs):
                print(f'Web {n}/{len(jobs)}, failures {len(failures)}', flush=True)
    write_json(CACHE / 'web-failures.json', failures)


def import_bucket():
    results = []
    with zipfile.ZipFile(BUCKET) as archive:
        for item in archive.infolist():
            parts = Path(item.filename).parts
            if len(parts) != 3 or not item.filename.lower().endswith('.png'):
                continue
            alias = parts[1]
            game, name = ROSTER[alias]
            results.append(save_image(game, name, 'mirror/' + slug(Path(parts[2]).stem),
                archive.read(item), dict(source=REPO + '/blob/' + COMMIT + '/' + '/'.join(parts[1:]),
                                         origin='community-or-unverified')))
    write_json(CACHE / 'bucket-images.json', results)
    print('Mirror images:', len(results), flush=True)


def import_v3():
    results = []
    errors = []
    ledger = CACHE / 'v3-images.json'
    previous = json.loads(ledger.read_text(encoding='utf-8')) if ledger.exists() else []
    sources = json.loads((ROOT / 'source-assets/drv3-sources.json').read_text(encoding='utf-8'))
    for source in sources:
        if not source['name'].endswith('.zip'):
            continue
        filename = source['name'].lower().replace(' ', '-')
        path = ROOT / 'source-assets/downloads/drv3' / filename
        name = source['name'][:-4]
        name = {'Keebo':'K1-B0', 'Kirumi Toujo':'Kirumi Tojo',
                'Tsumugi Cosplay Sprites':'Tsumugi Shirogane', 'Tsumugi Cosplay':'Tsumugi Shirogane'}.get(name, name)
        if not path.exists():
            unpacked = PUBLIC / 'assets/characters/drv3' / slug(name) / 'sprites/fullbody' / slug(source['name'][:-4])
            if unpacked.exists():
                known = {r['path']: r for r in previous if r.get('archive') == source['name']}
                for image in sorted(p for p in unpacked.rglob('*') if p.suffix.lower() in ('.png', '.webp')):
                    relative = image.relative_to(PUBLIC).as_posix()
                    if relative in known:
                        if hashlib.sha256(image.read_bytes()).hexdigest() != known[relative]['sha256']:
                            raise ValueError(f'Checksum mismatch: {relative}')
                        results.append(known[relative])
                        continue
                    key = image.relative_to(unpacked.parent.parent).with_suffix('').as_posix()
                    results.append(save_image('drv3', name, key, image.read_bytes(),
                        dict(source=source['url'], archive=source['name'], origin='game-rip-ziella')))
                write_json(CACHE / 'v3-images.json', results)
                continue
            errors.append(dict(name=source['name'], error='Archive unavailable'))
            continue
        if path.stat().st_size != int(source['size']):
            errors.append(dict(name=source['name'], error='Archive size mismatch or download still running'))
            continue
        count = 0
        with zipfile.ZipFile(path) as archive:
            for item in archive.infolist():
                if not item.filename.lower().endswith('.png'):
                    continue
                # Normalize individual path components, never extract arbitrary archive paths.
                parts = [slug(p) for p in Path(item.filename).with_suffix('').parts if p not in ('.', '..')]
                key = 'fullbody/' + slug(source['name'][:-4]) + '/' + '/'.join(parts)
                results.append(save_image('drv3', name, key, archive.read(item),
                    dict(source=source['url'], archive=source['name'], archiveMember=item.filename,
                         origin='game-rip-ziella')))
                count += 1
        print(f'V3 {name}: {count}', flush=True)
        write_json(CACHE / 'v3-images.json', results)
        # Archives are temporary downloads. Delete only this verified archive with native PowerShell.
        archive_root = str((ROOT / 'source-assets/downloads/drv3').resolve()).replace("'", "''")
        archive_path = str(path.resolve()).replace("'", "''")
        cleanup = (f"$base=(Resolve-Path -LiteralPath '{archive_root}').Path; "
                   f"$target=(Resolve-Path -LiteralPath '{archive_path}').Path; "
                   "if ([System.IO.Path]::GetDirectoryName($target) -ne $base) { throw 'Unsafe archive path' }; "
                   "Remove-Item -LiteralPath $target")
        subprocess.run(['powershell', '-NoProfile', '-Command', cleanup], check=True)
    write_json(CACHE / 'v3-images.json', results)
    write_json(CACHE / 'v3-failures.json', errors)


def catalog():
    directions_path = ROOT / 'src/data/sprite-directions.json'
    directions = json.loads(directions_path.read_text(encoding='utf-8')) if directions_path.exists() else {}
    records = []
    for filename in ('bucket-images.json', 'v3-images.json', 'supplement-images.json'):
        path = CACHE / filename
        if path.exists():
            records.extend(json.loads(path.read_text(encoding='utf-8')))
    path = CACHE / 'web-images.jsonl'
    if path.exists():
        records.extend(json.loads(x) for x in path.read_text(encoding='utf-8').splitlines())
    grouped = {}
    for record in records:
        if not (PUBLIC / record['path']).exists():
            continue
        grouped.setdefault((record['game'], record['name']), {})[record['path']] = record
    characters = []
    for (game, name), by_path in sorted(grouped.items()):
        images = sorted(by_path.values(), key=lambda r: (not r['transparent'],
                       r['origin'] != 'game-rip-ziella', r['key']))
        sprites = {r['key']:r['path'] for r in images}
        cid = game + '.' + slug(name)
        relative = Path('assets/characters') / game / slug(name) / 'character.json'
        default_sprite = directions.get(cid, {}).get('defaultSprite', images[0]['key'])
        if default_sprite not in sprites:
            raise ValueError(f'Missing curated default: {cid}: {default_sprite}')
        write_json(PUBLIC / relative, dict(id=cid, name=name, defaultSprite=default_sprite,
                   sprites=sprites, emotionsMapped=False))
        write_json(PUBLIC / relative.parent / 'sources.json', dict(images=images))
        characters.append(dict(id=cid, name=name, manifest=relative.as_posix(), spriteCount=len(images)))
    path = ROOT / 'src/data/characters.json'
    current = json.loads(path.read_text(encoding='utf-8'))
    imported = {c['id'] for c in characters}
    characters += [c for c in current['characters'] if c['id'] not in imported]
    write_json(path, dict(characters=characters))
    summary = dict(characters=len(grouped), images=sum(len(v) for v in grouped.values()),
                   bytes=sum(r['path'] and (PUBLIC/r['path']).stat().st_size for v in grouped.values() for r in v.values()),
                   missingSourceCharacters=[a for a,(g,n) in ROSTER.items() if (g,n) not in grouped],
                   groups={g:sum(1 for game,_ in grouped if g==game) for g in sorted({g for g,_ in grouped})})
    write_json(CACHE / 'summary.json', summary)
    print(json.dumps(summary, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['web','bucket','v3','catalog'])
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    {'web':import_web, 'bucket':import_bucket, 'v3':import_v3, 'catalog':catalog}[args.mode]()
