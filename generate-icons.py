"""Generate PWA icon PNGs for Sophia Oracle. Run: python generate-icons.py"""
import os, math, random
from PIL import Image, ImageDraw

ICONS_DIR = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(ICONS_DIR, exist_ok=True)


def soft_circle(draw, cx, cy, radius, color):
    """Draw a soft-edged circle with falloff."""
    r, g, b, peak_a = color
    for i in range(radius, 0, -1):
        t = (radius - i) / radius  # 0 at edge, 1 at center
        a = int(peak_a * t * t)    # quadratic falloff for soft edges
        if a < 1: continue
        draw.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(r, g, b, a))


def draw_icon(size, maskable=False):
    # Work on a 2x canvas for antialiasing, then downscale
    ss = 2  # supersample factor
    sz = size * ss
    img = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = sz / 64
    cx, cy = sz // 2, int(sz * 0.40)
    r = int(sz * 0.23)

    # ── Solid dark background ──
    bg = (10, 8, 18, 255)
    if maskable:
        draw.rectangle([0, 0, sz, sz], fill=bg)
    else:
        draw.rounded_rectangle([0, 0, sz - 1, sz - 1],
                               radius=int(sz * 0.20), fill=bg)

    # ── Minimal ambient glow — barely visible ──
    soft_circle(draw, cx, cy, int(r * 1.4), (40, 20, 80, 10))

    # ── Crystal ball — dark-to-medium purple sphere ──
    # Outer dark ring
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(20, 8, 45, 255))
    # Inner gradient: dark edge to slightly brighter center
    for i in range(r - 1, 0, -1):
        t = 1.0 - (i / r)  # 0 at edge, 1 at center
        t2 = t * t          # ease in
        red = int(20 + 100 * t2)
        grn = int(8 + 60 * t2)
        blu = int(45 + 140 * t2)
        draw.ellipse([cx - i, cy - i, cx + i, cy + i],
                     fill=(red, grn, blu, 255))

    # ── Inner mystical glow — subtle magenta/pink deep inside ──
    soft_circle(draw, cx, cy + int(r * 0.1), int(r * 0.45),
                (200, 40, 120, 50))

    # ── Glass highlight — small, crisp, top-left ──
    hx, hy = cx - int(r * 0.30), cy - int(r * 0.30)
    soft_circle(draw, hx, hy, int(r * 0.16), (255, 255, 255, 220))

    # ── Tiny catch light bottom-right ──
    soft_circle(draw, cx + int(r * 0.22), cy + int(r * 0.30),
                int(r * 0.06), (255, 255, 255, 80))

    # ── Sphere rim — very subtle magenta edge ──
    lw = max(1, int(s * 0.5))
    draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                 outline=(200, 0, 70, 40), width=lw)

    # ── Very faint outer aura ──
    aura_r = r + int(s * 1.5)
    draw.ellipse([cx - aura_r, cy - aura_r, cx + aura_r, cy + aura_r],
                 outline=(120, 80, 200, 10), width=max(1, int(s * 0.3)))

    # ── Base / stand ──
    base_top = cy + r + int(s * 2.5)
    base_h = int(s * 6)
    tw = int(r * 0.45)
    bw = int(r * 0.7)
    for row in range(base_h):
        t = row / base_h
        w = int(tw + (bw - tw) * t)
        y = base_top + row
        a = int(35 + 25 * (1 - t))
        draw.line([(cx - w, y), (cx + w, y)], fill=(180, 20, 70, a), width=1)
    draw.polygon([
        (cx - tw, base_top), (cx + tw, base_top),
        (cx + bw, base_top + base_h), (cx - bw, base_top + base_h),
    ], outline=(255, 0, 85, 25))

    # ── Tiny stars — scattered, dim ──
    random.seed(42)
    for _ in range(10):
        angle = random.uniform(0, math.pi * 2)
        dist = random.uniform(r * 1.3, r * 2.4)
        sx = int(cx + math.cos(angle) * dist)
        sy = int(cy + math.sin(angle) * dist * 0.9)
        margin = int(s * 5)
        if sx < margin or sx > sz - margin: continue
        if sy < margin or sy > sz - margin: continue
        sr = max(1, int(s * random.uniform(0.4, 1.2)))
        brightness = random.randint(130, 200)
        soft_circle(draw, sx, sy, sr,
                    (brightness, brightness - 40, 255, 120))

    # ── Cross sparkle on highlight ──
    sp_len = int(s * 2.5)
    for i in range(sp_len, 0, -1):
        a = int(60 * (1 - i / sp_len))
        draw.line([(hx - i, hy), (hx + i, hy)], fill=(255, 255, 255, a), width=1)
        draw.line([(hx, hy - i), (hx, hy + i)], fill=(255, 255, 255, a), width=1)

    # Downscale with antialiasing
    img = img.resize((size, size), Image.LANCZOS)
    return img


configs = [
    (192, "icon-192.png", False),
    (512, "icon-512.png", False),
    (192, "icon-maskable-192.png", True),
    (512, "icon-maskable-512.png", True),
]

for size, filename, maskable in configs:
    icon = draw_icon(size, maskable)
    path = os.path.join(ICONS_DIR, filename)
    icon.save(path, "PNG", optimize=True)
    fsize = os.path.getsize(path)
    print(f"  Created {path} ({fsize // 1024} KB)")

print("\nAll PWA icons generated!")
