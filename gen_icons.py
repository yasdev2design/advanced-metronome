"""Generate TAKT PNG icons (regular + maskable) without external dependencies."""
import zlib
import struct
import math

BG = (10, 12, 15)
RING = (200, 240, 74)
LINE = (34, 43, 54)


def rounded_rect_mask(size, radius):
    m = [[False] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            inside = True
            dx = dy = 0.0
            if x < radius:
                dx = radius - x
            if x > size - 1 - radius:
                dx = x - (size - 1 - radius)
            if y < radius:
                dy = radius - y
            if y > size - 1 - radius:
                dy = y - (size - 1 - radius)
            if dx > 0 and dy > 0:
                inside = math.hypot(dx, dy) <= radius
            m[y][x] = inside
    return m


def draw_icon(size, maskable):
    px = [[BG for _ in range(size)] for _ in range(size)]
    mask = rounded_rect_mask(size, size * 0.22) if not maskable else None

    cx = cy = (size - 1) / 2
    # inner border
    r_out = size * (0.34 if not maskable else 0.30)
    w = size * 0.055
    r_dot = size * (0.095 if not maskable else 0.085)
    tick_w = size * 0.055
    tick_h = size * 0.115
    tick_y = size * (0.125 if not maskable else 0.16)
    ring_r = size * (0.26 if not maskable else 0.22)

    for y in range(size):
        for x in range(size):
            if mask is not None and not mask[y][x]:
                px[y][x] = (0, 0, 0, 0)
                continue
            d = math.hypot(x - cx, y - cy)
            if abs(d - ring_r) <= w / 2:
                px[y][x] = RING
            elif d <= r_dot:
                px[y][x] = RING
            elif abs(x - cx) <= tick_w / 2 and tick_y <= y <= tick_y + tick_h:
                px[y][x] = RING
            elif not maskable and (
                abs(x - cx) > size * 0.455 - 1.5 and abs(y - cy) > size * 0.455 - 1.5
            ):
                pass  # keep corner bg
    return px


def write_png(path, size, maskable):
    px = draw_icon(size, maskable)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        for x in range(size):
            r, g, b, *a = px[y][x] + (255,) if len(px[y][x]) == 3 else px[y][x]
            raw += bytes((r, g, b, a[0] if a else 255))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'wrote {path} ({size}x{size})')


if __name__ == '__main__':
    write_png('icon-192.png', 192, False)
    write_png('icon-512.png', 512, False)
    write_png('maskable-192.png', 192, True)
    write_png('maskable-512.png', 512, True)
