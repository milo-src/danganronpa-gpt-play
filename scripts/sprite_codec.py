"""Smaller browser assets with byte-for-byte identical decoded RGBA pixels."""
import hashlib
import io

from PIL import Image


def compact_image(data):
    with Image.open(io.BytesIO(data)) as original:
        if getattr(original, 'n_frames', 1) != 1 or original.format == 'WEBP':
            return data, {}
        rgba = original.convert('RGBA')
        pixels = rgba.tobytes()
        output = io.BytesIO()
        options = dict(format='WEBP', lossless=True, exact=True, method=4)
        for name in ('icc_profile', 'exif', 'xmp'):
            if original.info.get(name):
                options[name] = original.info[name]
        rgba.save(output, **options)
        encoded = output.getvalue()
        if len(encoded) >= len(data):
            return data, {}
        with Image.open(io.BytesIO(encoded)) as decoded:
            if decoded.size != rgba.size or decoded.convert('RGBA').tobytes() != pixels:
                raise ValueError('Lossless conversion changed decoded pixels')
        return encoded, dict(originalSha256=hashlib.sha256(data).hexdigest(),
                             originalBytes=len(data), originalFormat=original.format,
                             rgbaSha256=hashlib.sha256(pixels).hexdigest(),
                             encoding='webp-lossless-exact')
