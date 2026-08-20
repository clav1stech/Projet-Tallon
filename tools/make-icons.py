#!/usr/bin/env python3
"""Génère les icônes d'écran d'accueil (PWA / apple-touch-icon).

Les icônes sont dessinées ici plutôt qu'éditées à la main : leurs dimensions
doivent rester cohérentes entre les deux modes et se régénérer à l'identique
après un changement de charte. Le rendu se fait en suréchantillonnage ×4 puis
réduction Lanczos — PIL ne lisse pas les primitives.

Usage : python3 tools/make-icons.py  (dépendance : pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "icons"
SIZES = (180, 192, 512)  # 180 = apple-touch-icon, 192/512 = manifest
SS = 4                   # facteur de suréchantillonnage
CANVAS = 512 * SS

WHITE = (255, 255, 255, 255)

# Dégradés de fond : bordeaux (--primary) pour le rail, teal→vert de la barre
# de progression voiture pour la route.
THEMES = {
    "train": ((135, 44, 59), (74, 22, 32)),
    "car": ((38, 166, 178), (86, 165, 92)),
}


def gradient(top, bottom):
    img = Image.new("RGBA", (CANVAS, CANVAS))
    draw = ImageDraw.Draw(img)
    for y in range(CANVAS):
        t = y / (CANVAS - 1)
        draw.line(
            [(0, y), (CANVAS, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,),
        )
    return img


def px(v):
    return v * CANVAS


def draw_train(draw, bg):
    # Nez de motrice vu de face : caisse arrondie, pare-brise, deux feux.
    draw.rounded_rectangle(
        [px(0.20), px(0.09), px(0.80), px(0.83)], radius=px(0.20), fill=WHITE
    )
    draw.rounded_rectangle(
        [px(0.29), px(0.21), px(0.71), px(0.43)], radius=px(0.07), fill=bg
    )
    for cx in (0.365, 0.635):
        draw.ellipse(
            [px(cx - 0.055), px(0.55), px(cx + 0.055), px(0.66)], fill=bg
        )
    # Jupe et rails : ancrent la motrice au sol et lèvent l'ambiguïté avec un bus.
    draw.rounded_rectangle(
        [px(0.14), px(0.845), px(0.86), px(0.90)], radius=px(0.027), fill=WHITE
    )
    draw.rounded_rectangle(
        [px(0.30), px(0.925), px(0.70), px(0.965)], radius=px(0.020), fill=WHITE
    )


def draw_car(draw, bg):
    # Profil de berline : caisse basse et large, pavillon en retrait, roues
    # discrètes — des roues surdimensionnées font lire un jouet à petite taille.
    draw.polygon(
        [
            (px(0.255), px(0.470)),
            (px(0.395), px(0.250)),
            (px(0.655), px(0.250)),
            (px(0.780), px(0.470)),
        ],
        fill=WHITE,
    )
    draw.rounded_rectangle(
        [px(0.055), px(0.455), px(0.945), px(0.670)], radius=px(0.080), fill=WHITE
    )
    # Vitres séparées par le montant central
    draw.polygon(
        [
            (px(0.330), px(0.450)),
            (px(0.428), px(0.292)),
            (px(0.498), px(0.292)),
            (px(0.498), px(0.450)),
        ],
        fill=bg,
    )
    draw.polygon(
        [
            (px(0.535), px(0.450)),
            (px(0.535), px(0.292)),
            (px(0.640), px(0.292)),
            (px(0.725), px(0.450)),
        ],
        fill=bg,
    )
    for cx in (0.285, 0.715):
        draw.ellipse([px(cx - 0.115), px(0.585), px(cx + 0.115), px(0.815)], fill=WHITE)
        draw.ellipse([px(cx - 0.048), px(0.652), px(cx + 0.048), px(0.748)], fill=bg)


GLYPHS = {"train": draw_train, "car": draw_car}


def build(name):
    top, bottom = THEMES[name]
    img = gradient(top, bottom)
    GLYPHS[name](ImageDraw.Draw(img), top + (255,))
    return img


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in GLYPHS:
        master = build(name)
        for size in SIZES:
            # Fond opaque : iOS compose les zones alpha sur du noir.
            out = master.resize((size, size), Image.LANCZOS).convert("RGB")
            path = OUT_DIR / f"{name}-{size}.png"
            out.save(path, optimize=True)
            print(f"{path.relative_to(OUT_DIR.parent.parent)} ({size}×{size})")


if __name__ == "__main__":
    main()
