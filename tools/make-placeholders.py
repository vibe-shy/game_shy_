#!/usr/bin/env python3
"""assets/ 에 자리 채우기 스프라이트 PNG 를 만든다.

    python3 tools/make-placeholders.py

진짜 그림이 준비되기 전까지 쓰는 임시 이미지다. 지금 게임이 캔버스에 직접
그리던 도형을 그대로 PNG 로 옮긴 것이라 화면이 달라 보이지 않는다.
목적은 그림 자체가 아니라 파이프라인 검증이다 — 크기·중심·로딩·폴백이
맞는지 미리 확인해 두면, 나중에 진짜 PNG 를 같은 이름으로 덮어쓰기만 하면 된다.

색은 js/content.js 에서 읽어 온다. 손으로 복사해 두면 한쪽만 고쳤을 때 어긋난다.

필요한 것: pip install Pillow
"""
import math
import pathlib
import re
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow 가 필요하다:  pip install Pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
SS = 4  # 슈퍼샘플링 배율 — 크게 그린 뒤 줄여서 계단현상을 없앤다


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def read_colors():
    """content.js 에서 색을 긁어온다. 한쪽만 고쳐 어긋나는 걸 막는다."""
    src = (ROOT / "js" / "content.js").read_text(encoding="utf-8")

    col = {}
    block = re.search(r"AF\.COLOR = \{(.*?)\n\};", src, re.S).group(1)
    for k, v in re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", block):
        col[k] = hex2rgb(v)

    enemies = {}
    for name, body in re.findall(r"^  (\w+): \{(.*?)\n  \},?$", src, re.S | re.M):
        m = re.search(r"color: '(#[0-9a-fA-F]{6})', dark: '(#[0-9a-fA-F]{6})'", body)
        if m:
            enemies[name] = (hex2rgb(m.group(1)), hex2rgb(m.group(2)))
    return col, enemies


COL, ENEMY = read_colors()


def canvas(size):
    img = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def save(img, name, size):
    img = img.resize((size, size), Image.LANCZOS)
    img.save(OUT / (name + ".png"))
    return (OUT / (name + ".png")).stat().st_size


def poly(draw, cx, cy, r, sides, rot=0.0, fill=None, outline=None, width=0):
    pts = [(cx + math.cos(rot + i * 2 * math.pi / sides) * r,
            cy + math.sin(rot + i * 2 * math.pi / sides) * r) for i in range(sides)]
    draw.polygon(pts, fill=fill, outline=outline, width=width)


def make_creature(name, size, shape, fill, dark):
    """적/플레이어 한 마리. 히트박스보다 그림이 작게 들어가도록 여백을 둔다.

    여백을 두는 이유: 진짜 그림은 모자·활·날개가 히트박스 밖으로 삐져나온다.
    같은 캔버스 크기에서 그 여백을 미리 확보해 둬야 나중에 크기가 안 바뀐다."""
    img, d = canvas(size)
    c = size * SS / 2
    r = c * 0.46           # 히트박스에 해당하는 반지름 (캔버스의 46%)
    lw = max(2, int(size * SS * 0.022))

    if shape == "tri":
        # 오른쪽을 보는 삼각형 — 그릴 때 각도로 회전시킨다
        pts = [(c + r * 1.25, c), (c - r * 0.7, c - r * 0.85), (c - r * 0.7, c + r * 0.85)]
        d.polygon(pts, fill=fill, outline=dark, width=lw)
    elif shape == "square":
        q = r * 0.88
        d.rectangle([c - q, c - q, c + q, c + q], fill=fill, outline=dark, width=lw)
    elif shape == "diamond":
        d.polygon([(c, c - r), (c + r, c), (c, c + r), (c - r, c)],
                  fill=fill, outline=dark, width=lw)
    elif shape == "blob":
        d.ellipse([c - r, c - r, c + r, c + r], fill=fill, outline=dark, width=lw)
    elif shape == "boss":
        poly(d, c, c, r, 6, -math.pi / 2, fill=fill, outline=dark, width=lw)
    elif shape == "player":
        d.ellipse([c - r, c - r, c + r, c + r], fill=fill, outline=None)
        inner = r * 0.5
        d.ellipse([c - inner, c - inner, c + inner, c + inner], fill=dark)
        # 활: 오른쪽(조준 방향)으로 호
        bow = r * 0.95
        d.arc([c + r * 0.5 - bow, c - bow, c + r * 0.5 + bow, c + bow],
              start=-60, end=60, fill=fill, width=int(lw * 1.6))
    return img, save(img, name, size)


def make_arrow(size):
    img, d = canvas(size)
    c = size * SS / 2
    col = COL["arrow"]
    body_h = size * SS * 0.13
    d.rounded_rectangle([c - size * SS * 0.36, c - body_h / 2,
                         c + size * SS * 0.18, c + body_h / 2],
                        radius=body_h / 2, fill=col)
    d.polygon([(c + size * SS * 0.40, c),
               (c + size * SS * 0.10, c - size * SS * 0.17),
               (c + size * SS * 0.10, c + size * SS * 0.17)], fill=col)
    return img, save(img, "arrow", size)


def make_bolt(size):
    img, d = canvas(size)
    c = size * SS / 2
    r = size * SS * 0.26
    d.ellipse([c - r, c - r, c + r, c + r], fill=COL["enemyShot"])
    hr = r * 0.35
    hx, hy = c - r * 0.25, c - r * 0.25
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255, 180))
    return img, save(img, "bolt", size)


def make_floor(size):
    """바닥 타일. 평평하게 두고 아주 얇은 이음매만 넣는다.

    얼룩이나 무늬를 넣으면 144칸이 반복되며 눈에 거슬린다. 실제 아트가
    들어오기 전까지는 바닥이 조용한 편이 게임 물체를 보기 좋다."""
    img, d = canvas(size)
    s = size * SS
    d.rectangle([0, 0, s, s], fill=COL["floorAlt"] + (255,))
    seam = max(1, int(s * 0.012))
    d.rectangle([0, 0, s, seam], fill=COL["floor"] + (255,))
    d.rectangle([0, 0, seam, s], fill=COL["floor"] + (255,))
    return img, save(img, "floor", size)


def make_wall(size):
    img, d = canvas(size)
    s = size * SS
    pad = s * 0.035
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.11,
                        fill=COL["wall"] + (255,))
    d.rounded_rectangle([pad, pad, s - pad, pad + (s - pad * 2) * 0.42],
                        radius=s * 0.11, fill=COL["wallTop"] + (255,))
    return img, save(img, "wall", size)


# 이름 → (파일 크기, 모양). 크기는 히트박스 지름의 약 2.15배를 2배 해상도로 뽑은 값.
CREATURES = [
    ("player",        112, "player",  COL["player"], COL["playerIn"]),
    ("enemy-chaser",  112, "tri",     *ENEMY["chaser"]),
    ("enemy-shooter", 112, "square",  *ENEMY["shooter"]),
    ("enemy-orbiter", 120, "diamond", *ENEMY["orbiter"]),
    ("enemy-charger", 136, "tri",     *ENEMY["charger"]),
    ("enemy-splitter", 160, "blob",   *ENEMY["splitter"]),
    ("enemy-shard",    80, "tri",     *ENEMY["shard"]),
    ("enemy-boss",    280, "boss",    *ENEMY["boss"]),
]

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    total = 0
    for name, size, shape, fill, dark in CREATURES:
        _, n = make_creature(name, size, shape, fill, dark)
        total += n
        print("  %-16s %4dx%-4d %5d bytes" % (name + ".png", size, size, n))
    for fn, size, label in ((make_arrow, 48, "arrow"), (make_bolt, 48, "bolt"),
                            (make_floor, 112, "floor"), (make_wall, 112, "wall")):
        _, n = fn(size)
        total += n
        print("  %-16s %4dx%-4d %5d bytes" % (label + ".png", size, size, n))
    print("\nassets/ 에 %d개, 합계 %.1f KB" % (len(CREATURES) + 4, total / 1024))
