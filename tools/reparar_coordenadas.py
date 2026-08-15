#!/usr/bin/env python3
"""
Repara las coordenadas que Google Sheets destruyó al pegarlas.

    python3 tools/ayuda-sismo/reparar_coordenadas.py

Lee la pestaña pública del libro DATASET-ACOPIOS y escribe
`ayuda-sismo/acopios-coordenadas-reparadas.csv`.

⚠️⚠️ EL PROBLEMA, medido: 150 de 162 filas tienen la coordenada rota.

El libro está en configuración regional donde el punto es el separador de
MILES, no de decimales. Al pegar `4.668272`, la hoja entiende el número
4.668.272 y lo guarda así. Y no es un problema de presentación: la hoja
EXPORTA `4.668.272`, el Worker hace `Number("4.668.272")` → NaN, y descarta la
coordenada sin decir nada. O sea que hoy ninguna sirve y todos los puntos
siguen cayendo al centro del municipio.

LA SOLUCIÓN DE FONDO no es este script, es que la columna no se reinterprete:

  1. Selecciona LATITUD y LONGITUD → Formato → Número → **Texto sin formato**.
  2. Pega encima los valores de este CSV.

Con la columna en texto, la hoja no reinterpreta nada y da igual la
configuración regional de quien edite —que en una hoja pública, editada por
mucha gente, es lo que realmente importa—.

CÓMO SE RECUPERA UN NÚMERO ROTO: los dígitos están todos, solo se perdió dónde
iba el punto. Y en Colombia la parte entera está acotada: la latitud va de -4,3
a 13,6 y la longitud de -82 a -66,8. Así que se prueban las dos posiciones
posibles del punto y se acepta la única que cae dentro del país. `4668272` solo
puede ser 4,668272; `-7406628` solo puede ser -74,06628.
"""

import csv
import io
import re
import sys
import urllib.request
from pathlib import Path

LIBRO = '1dj1fNYuwGMW0zLit4I6w_5abJGxuGVZttwA1QMbvQts'
GID = '0'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126 Safari/537.36')

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / 'datos' / 'acopios-coordenadas-reparadas.csv'

RANGO = {'lat': (-4.3, 13.6), 'lon': (-82.0, -66.8)}


def reparar(txt, cual):
    """Devuelve el número como texto con punto decimal, o '' si no se puede."""
    s = str(txt or '').strip().replace(' ', '')
    if not s:
        return ''
    lo, hi = RANGO[cual]
    signo = -1 if s.startswith('-') else 1
    digitos = re.sub(r'\D', '', s)
    if not digitos:
        return ''

    # ¿Ya viene bien? Un solo separador y dentro de rango.
    if s.count('.') + s.count(',') <= 1:
        try:
            v = float(s.replace(',', '.'))
            if lo <= v <= hi:
                return f'{v:.6f}'.rstrip('0').rstrip('.')
        except ValueError:
            pass

    # Roto: se prueba el punto después de 1 y de 2 dígitos y se queda el que
    # cae dentro de Colombia. Nunca hay dos candidatos válidos, porque los
    # rangos de latitud y longitud no admiten las dos lecturas a la vez.
    validos = []
    for corte in (1, 2):
        if len(digitos) <= corte:
            continue
        v = signo * float(f'{digitos[:corte]}.{digitos[corte:]}')
        if lo <= v <= hi:
            validos.append(v)
    if len(validos) != 1:
        return ''
    return f'{validos[0]:.6f}'.rstrip('0').rstrip('.')


def main():
    url = f'https://docs.google.com/spreadsheets/d/{LIBRO}/export?format=csv&gid={GID}'
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        filas = list(csv.reader(io.StringIO(r.read().decode('utf-8'))))

    cab = filas[0]
    i_la, i_lo = cab.index('LATITUD'), cab.index('LONGITUD')

    salida, arregladas, perdidas, ya_ok = [], 0, [], 0
    for f in filas[1:]:
        f = f + [''] * (len(cab) - len(f))
        if not f[0].strip():
            continue
        antes_la, antes_lo = f[i_la].strip(), f[i_lo].strip()
        if antes_la or antes_lo:
            la, lo = reparar(antes_la, 'lat'), reparar(antes_lo, 'lon')
            if la and lo:
                if (la, lo) == (antes_la, antes_lo):
                    ya_ok += 1
                else:
                    arregladas += 1
                f[i_la], f[i_lo] = la, lo
            else:
                perdidas.append(f'{f[0][:34]} · {antes_la} / {antes_lo}')
                f[i_la], f[i_lo] = '', ''
        salida.append(f)

    with open(SALIDA, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(cab)
        w.writerows(salida)

    print(f'{len(salida)} filas → {SALIDA.relative_to(RAIZ)}')
    print(f'  reparadas:        {arregladas}')
    print(f'  ya estaban bien:  {ya_ok}')
    print(f'  sin coordenada:   {sum(1 for f in salida if not f[i_la])}')
    if perdidas:
        print(f'\n{len(perdidas)} no se pudieron recuperar (quedan en blanco, '
              f'que es mejor que un punto inventado):')
        for x in perdidas[:10]:
            print('   ·', x)


if __name__ == '__main__':
    sys.exit(main())
