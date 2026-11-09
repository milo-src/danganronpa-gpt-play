"""Build a quiet, non-tonal keyboard tap; no external samples required."""
import math
from pathlib import Path
import random
import struct
import wave

rate = 48000
count = int(rate * .038)
rng = random.Random(43)
low = 0.0
body = 0.0
samples = []
for i in range(count):
    t = i / rate
    # Filter out the sharp high frequencies; two soft contacts suggest a key press.
    low += .16 * (rng.uniform(-1, 1) - low)
    body += .06 * (low - body)
    attack = 1 - math.exp(-t / .0015)
    release = (1 - i / (count - 1)) ** 2
    envelope = attack * math.exp(-t / .008) * release
    second = max(0, t - .012)
    envelope += .25 * (1 - math.exp(-second / .001)) * math.exp(-second / .004) * release
    samples.append((low - .6 * body) * envelope)
peak = max(map(abs, samples))
pcm = [round(value / peak * .12 * 32767) for value in samples]
pcm[0] = pcm[-1] = 0
target = Path(__file__).resolve().parents[1] / 'public/assets/audio/ui/typing-soft.wav'
target.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(target), 'wb') as out:
    out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    out.writeframes(struct.pack('<' + 'h' * len(pcm), *pcm))
print(f'{target}: {len(pcm) / rate:.3f}s, peak 0.12')
