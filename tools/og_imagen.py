#!/usr/bin/env python3
"""
Genera la imagen de vista previa del enlace (public/og.jpg, 1200x630).

Es lo que se ve al pegar reconstruyocolombia.com en WhatsApp, que es como va a
circular esto. Sin imagen, la tarjeta sale como un texto gris más en el chat;
con imagen ocupa el ancho de la pantalla y se lee de una.

Se usa la misma paleta y la misma jerarquía de la puerta de entrada: papel,
kicker oxblood, titular negro apretado. No se inventa una identidad aparte.

    python3 tools/og_imagen.py

Requiere Pillow. Re-correr solo si cambia el texto o la marca.
"""
import pathlib
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
PAPEL = (244, 241, 236)
TINTA = (26, 21, 16)
OX = (180, 50, 30)
TENUE = (110, 100, 92)

SALIDA = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'og.jpg'

# Del sistema: la página tampoco descarga fuentes. Se prueban en orden.
CANDIDATAS_BOLD = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial Bold.ttf',
]
CANDIDATAS_REG = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
]


def fuente(candidatas, tam):
    for ruta in candidatas:
        try:
            return ImageFont.truetype(ruta, tam)
        except OSError:
            continue
    return ImageFont.load_default()


def ancho(dib, texto, f):
    x0, _, x1, _ = dib.textbbox((0, 0), texto, font=f)
    return x1 - x0


def envolver(dib, texto, f, tope):
    """Parte el texto en líneas que quepan en `tope` píxeles."""
    lineas, actual = [], ''
    for palabra in texto.split():
        prueba = f'{actual} {palabra}'.strip()
        if ancho(dib, prueba, f) <= tope:
            actual = prueba
        else:
            if actual:
                lineas.append(actual)
            actual = palabra
    if actual:
        lineas.append(actual)
    return lineas


def main():
    img = Image.new('RGB', (W, H), PAPEL)
    d = ImageDraw.Draw(img)

    # Trama diagonal tenue, la misma textura de fondo de la página.
    for x in range(-H, W, 26):
        d.line([(x, 0), (x + H, H)], fill=(236, 231, 224), width=1)
        d.line([(x + H, 0), (x, H)], fill=(238, 233, 226), width=1)

    # Banda superior: firma de color, como la barra de la página.
    d.rectangle([0, 0, W, 14], fill=OX)

    m = 84
    f_kick = fuente(CANDIDATAS_BOLD, 26)
    f_tit = fuente(CANDIDATAS_BOLD, 82)
    f_sub = fuente(CANDIDATAS_REG, 34)
    f_pie = fuente(CANDIDATAS_REG, 26)

    y = 116
    kicker = 'SISMO DEL 10 DE AGOSTO  ·  INCENDIOS EN NARIÑO'
    d.text((m, y), kicker, font=f_kick, fill=OX)
    y += 62

    for linea in envolver(d, 'Pide ayuda o ayuda a quien la necesita', f_tit, W - m * 2):
        d.text((m, y), linea, font=f_tit, fill=TINTA)
        y += 92

    y += 18
    sub = ('Mapa abierto de necesidades: rescate, víveres, salud, '
           'refugio y personas buscadas.')
    for linea in envolver(d, sub, f_sub, W - m * 2):
        d.text((m, y), linea, font=f_sub, fill=TENUE)
        y += 46

    # Pie: el dominio, que es lo que la persona va a teclear si reenvía a voz.
    d.text((m, H - 78), 'reconstruyocolombia.com', font=f_pie, fill=TINTA)
    aviso = 'No es un canal oficial · emergencias: 123'
    d.text((W - m - ancho(d, aviso, f_pie), H - 78), aviso, font=f_pie, fill=TENUE)

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    img.save(SALIDA, 'JPEG', quality=88, optimize=True)
    print(f'{SALIDA}  {SALIDA.stat().st_size // 1024} KB  {W}x{H}')


if __name__ == '__main__':
    main()
