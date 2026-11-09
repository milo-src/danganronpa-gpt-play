"""Import original audio from installed Steam games; never modifies game files.

Requires ffmpeg (or imageio-ffmpeg) and vgmstream-cli. WAD/SPC layouts:
https://github.com/SpiralFramework/Spiral/tree/master/formats
Outputs a local pack, including source IDs for every sound.
"""
import argparse
import json
import pathlib
import re
import shutil
import struct
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
MUSIC = {
    'dr1': dict(daily=12, morning=4, tension=7, mystery=18, sad=11,
                investigation=16, trial=21, debate=24, climax=28, monokuma=19),
    'dr2': dict(daily=3, morning=6, tension=10, mystery=19, sad=15,
                investigation=4, trial=23, debate=27, climax=32, monokuma=12),
    'drv3': dict(daily=5, morning=12, tension=6, mystery=17, sad=24,
                 investigation=9, trial=33, debate=37, climax=45, monokuma=18),
}


class Wad:
    def __init__(self, path):
        self.path = path
        with path.open('rb') as f:
            def u32(): return struct.unpack('<I', f.read(4))[0]
            def string(): return f.read(u32()).decode('utf-8')
            if f.read(4) != b'AGAR': raise ValueError('Not a WAD: ' + str(path))
            u32(); u32(); f.read(u32())
            self.entries = {}
            for _ in range(u32()):
                name = string()
                self.entries[name] = struct.unpack('<QQ', f.read(16))
            for _ in range(u32()):
                string()
                for _ in range(u32()): string(); f.read(1)
            self.base = f.tell()

    def read(self, name):
        size, offset = self.entries[name]
        with self.path.open('rb') as f:
            f.seek(self.base + offset)
            data = f.read(size)
        if len(data) != size: raise ValueError('Incomplete WAD entry: ' + name)
        return data


def spc(path, wanted):
    data = path.read_bytes()
    if data[:4] != b'CPS.': raise ValueError('Not an SPC: ' + str(path))
    result, pos = {}, 80
    for _ in range(struct.unpack_from('<I', data, 40)[0]):
        flag, _, size, raw, n = struct.unpack_from('<HHIII', data, pos)
        name = data[pos + 32:pos + 32 + n].decode()
        pos += 32 + ((n + 16) // 16) * 16
        if name in wanted:
            packed = data[pos:pos + size]
            if flag == 2:
                output, i = bytearray(), 0
                while i < len(packed):
                    flags = packed[i]; i += 1
                    for bit in range(7, -1, -1):
                        if i >= len(packed): break
                        if flags & (1 << bit): output.append(packed[i]); i += 1
                        else:
                            word = int.from_bytes(packed[i:i + 2], 'little'); i += 2
                            for _ in range((word >> 10) + 2): output.append(output[(word & 1023) - 1024])
                packed = bytes(output)
            if len(packed) != raw: raise ValueError('SPC length mismatch: ' + name)
            result[name] = packed
        pos += (size + 15) // 16 * 16
    return result


def pak_strings(data):
    result = {}
    for i in range(struct.unpack_from('<I', data)[0]):
        offset = struct.unpack_from('<I', data, 4 + i * 4)[0]
        end = offset + 2
        while end + 2 <= len(data) and data[end:end + 2] != b'\0\0': end += 2
        result[i] = data[offset:end].decode('utf-16le').lstrip('\ufeff')
    return result


def stx_strings(data):
    result = {}
    for i in range(struct.unpack_from('<I', data, 20)[0]):
        key, offset = struct.unpack_from('<II', data, 32 + i * 8)
        end = offset
        while data[end:end + 2] != b'\0\0': end += 2
        result[key] = data[offset:end].decode('utf-16le')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--steam-common', type=pathlib.Path, required=True)
    parser.add_argument('--vgmstream', type=pathlib.Path,
                        default=ROOT / 'source-assets/downloads/audio-work/vgmstream/vgmstream-cli.exe')
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg'))
    args = parser.parse_args()
    if not args.ffmpeg:
        import imageio_ffmpeg
        args.ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    if not args.vgmstream.is_file(): raise SystemExit('Pass --vgmstream /path/to/vgmstream-cli.exe')
    dest = ROOT / 'public/assets/audio/local'
    dest.mkdir(parents=True, exist_ok=True)
    catalog = {'version': 1, 'games': {}}
    def run(command):
        return subprocess.check_output([str(x) for x in command], stderr=subprocess.STDOUT,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).decode('utf-8', errors='replace')
    def encode(source, target):
        run([args.ffmpeg, '-v', 'error', '-y', '-i', source, '-vn', '-c:a', 'libvorbis', '-q:a', '4', target])
    def decode(source, stream, target, temp):
        wav = temp / 'decoded.wav'
        run([args.vgmstream, '-i', '-s', stream, '-o', wav, source])
        encode(wav, target)
    with tempfile.TemporaryDirectory(prefix='dgp-audio-') as work:
        temp = pathlib.Path(work)
        for game, title in [('dr1', 'Danganronpa Trigger Happy Havoc'),
                            ('dr2', 'Danganronpa 2 Goodbye Despair'),
                            ('drv3', 'Danganronpa V3 Killing Harmony')]:
            install = args.steam_common / title
            if not install.is_dir(): continue
            folder = dest / game; folder.mkdir(exist_ok=True)
            pack = {'music': {}, 'effects': {}, 'ambience': {}}
            if game != 'drv3':
                wad = Wad(install / (game + '_data.wad'))
                loc = Wad(install / (game + '_data_us.wad'))
                names = pak_strings(loc.read(next(n for n in loc.entries if n.lower().endswith('/02_bgmname.pak'))))
                for cue, index in MUSIC[game].items():
                    name = next(n for n in wad.entries if n.endswith(f'bgm_hca.awb.{index:05}.ogg'))
                    source = temp / 'source.ogg'; source.write_bytes(wad.read(name))
                    target = folder / (cue + '.ogg'); encode(source, target)
                    record = {'path': target.relative_to(ROOT).as_posix(), 'name': names[index], 'source': name}
                    loop = name[:-4] + '.loop'
                    if loop in wad.entries:
                        _, start, end = struct.unpack('<III', wad.read(loop))
                        record.update(loopStart=start / 44100, loopEnd=end / 44100)
                    pack['music'][cue] = record
                bank = temp / (game + '-ui.acb')
                name = next(n for n in wad.entries if n.endswith('/se0_000.acb' if game == 'dr1' else '/SE0_0.acb'))
                bank.write_bytes(wad.read(name))
            else:
                base = install / 'data/win'
                parts = spc(base / 'game_resident/game_resident.spc', {'BGM.acb', 'SE0_0.acb'})
                names = stx_strings(spc(base / 'game_resident/game_resident_US.spc', {'O-Bgm.stx'})['O-Bgm.stx'])
                # vgmstream reads cue names from the adjacent ACB, not guessed OST order.
                (temp / 'BGM.acb').write_bytes(parts['BGM.acb'])
                shutil.copyfile(base / 'sound/BGM.awb', temp / 'BGM.awb')
                bank = temp / 'BGM.awb'
                indices = {}
                for stream in range(1, 94):
                    info = run([args.vgmstream, '-m', '-s', stream, bank])
                    match = re.search(r'stream name: V3_BGM_(\d+)', info)
                    if match: indices[int(match[1])] = (stream, info)
                for cue, index in MUSIC[game].items():
                    stream, info = indices[index]
                    target = folder / (cue + '.ogg'); decode(bank, stream, target, temp)
                    record = {'path': target.relative_to(ROOT).as_posix(), 'name': names[index], 'source': f'BGM.awb:V3_BGM_{index:03}'}
                    rate = int(re.search(r'sample rate: (\d+)', info)[1])
                    for field, label in [('loopStart', 'loop start'), ('loopEnd', 'loop end')]:
                        match = re.search(label + r': (\d+)', info)
                        if match: record[field] = int(match[1]) / rate
                    pack['music'][cue] = record
                bank = temp / 'v3-ui.acb'; bank.write_bytes(parts['SE0_0.acb'])
            # Keep source IDs visible: these are original samples, not synthesized sounds.
            for cue, stream in [('click', 1), ('type', 4), ('evidence', 2), ('objection', 13)]:
                target = folder / (cue + '.ogg'); decode(bank, stream, target, temp)
                info = run([args.vgmstream, '-m', '-s', stream, bank])
                name = re.search(r'stream name: (.+)', info)[1].strip()
                pack['effects'][cue] = {'path': target.relative_to(ROOT).as_posix(), 'name': name, 'source': f'{bank.name}:{name}'}
            catalog['games'][game] = pack
            print(game, 'imported:', len(pack['music']), 'music,', len(pack['effects']), 'effects', flush=True)
        target = dest / 'catalog.json'
        staging = target.with_suffix('.tmp')
        staging.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
        staging.replace(target)
    print('Pack:', dest)


if __name__ == '__main__': main()
