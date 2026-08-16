#!/usr/bin/env python3
"""
Llena LATITUD y LONGITUD de la hoja de acopios, sitio por sitio.

    python3 tools/ayuda-sismo/geocodificar_acopios.py

Lee la pestaña pública del libro DATASET-ACOPIOS y escribe
`ayuda-sismo/acopios-con-coordenadas.csv` con las 15 columnas, listo para
pegar de vuelta.

⚠️⚠️ NO se le pregunta a un modelo de lenguaje por las coordenadas. Un modelo
responde un par de números con total seguridad y sin manera de saber si son
los correctos: producir un pin que PARECE exacto y está a cinco cuadras es
peor que dejar el punto en el centro del municipio, porque el centro se
declara como aproximado y el pin falso no. Acá cada coordenada sale de un
registro oficial de direcciones y se valida antes de aceptarla.

Fuentes, por ciudad:

  Bogotá   Placa Domiciliaria de Catastro Distrital (ArcGIS público). Es el
           registro de las placas reales: si la dirección existe, el punto es
           el de la puerta.
  resto    Nominatim buscando por NOMBRE del sitio, con las mismas tres
           validaciones que ya usa el Worker (≤30 km del centro del municipio,
           tipo de objeto que no sea una vía, y una palabra distintiva del
           nombre presente en la respuesta).

⚠️ Nominatim NO sirve para direcciones colombianas y por eso no se usa así:
está medido en este proyecto que la numeración le sale invertida (la #180 al
sur de la #12) con errores de 5 a 19 km.
"""

import csv
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

LIBRO = '1dj1fNYuwGMW0zLit4I6w_5abJGxuGVZttwA1QMbvQts'
GID_PUBLICA = '0'

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / 'datos' / 'acopios-con-coordenadas.csv'

PLACAS = ('https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services'
          '/catastro/placadomiciliaria/MapServer/0/query')
NOMINATIM = 'https://nominatim.openstreetmap.org/search'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126 Safari/537.36')

BOGOTA_BBOX = (4.40, 4.87, -74.28, -73.95)   # lat min/max, lon min/max

# Centro de los municipios que aparecen en la hoja, para validar distancias.
CENTROS = {
    'bogota': (4.6486, -74.1032), 'cali': (3.4372, -76.5225),
    'pereira': (4.8087, -75.6906), 'medellin': (6.2447, -75.5748),
    'manizales': (5.0689, -75.5174), 'mosquera': (4.7059, -74.2300),
    'barranquilla': (10.9878, -74.7889), 'bucaramanga': (7.1254, -73.1198),
    'funza': (4.7167, -74.2117), 'cajica': (4.9178, -74.0278),
    'armenia': (4.5339, -75.6811), 'quibdo': (5.6947, -76.6611),
    'soacha': (4.5794, -74.2168), 'chia': (4.8611, -74.0586),
}

# Nombres de vía: la hoja los escribe de siete maneras y el registro oficial
# solo entiende la abreviatura de dos letras.
VIAS = [
    (r'\bavenida\s+carrera\b|\bav\.?\s*cra\b|\bak\b', 'AK'),
    (r'\bavenida\s+calle\b|\bav\.?\s*calle\b|\bac\b', 'AC'),
    (r'\b(?:carrera|cra|cr|kra|kr|k)(?=\s|\d)', 'KR'),
    (r'\b(?:calle|cll|cl)(?=\s|\d)', 'CL'),
    (r'\b(?:diagonal|diag|dg)(?=\s|\d)', 'DG'),
    (r'\b(?:transversal|transv|trans|tv)(?=\s|\d)', 'TV'),
]
# Cuando la placa exacta no existe se acepta la más cercana de la MISMA vía,
# pero solo dentro de este margen de numeración: en Bogotá 20 números son
# menos de media cuadra. Más allá ya no es "la puerta", es "por ahí".
MARGEN_PLACA = 20


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s).strip()


def pedir(url, params=None):
    if params:
        url = f'{url}?{urllib.parse.urlencode(params)}'
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def partir_direccion(d):
    """'Carrera 15 a # 122-27' → ('KR 15A', '122', '27'). None si no parece
    una dirección de nomenclatura bogotana."""
    t = norm(d).replace('.', ' ').replace('°', ' ')
    t = re.sub(r'\bn[o°º]?\s*[\.:]?\s*(?=\d)', ' ', t)      # "No. 81B" → "81B"
    t = re.sub(r'[#\-–—]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    sur = bool(re.search(r'\bsur\b', t))
    t = re.sub(r'\bsur\b', ' ', t)
    for pat, rep in VIAS:
        t = re.sub(pat, rep, t)
    t = re.sub(r'(\d)\s+([a-z])\b', r'\1\2', t)             # "15 a" → "15a"
    t = re.sub(r'\s+', ' ', t).strip()
    m = re.match(r'^(KR|CL|AK|AC|DG|TV)\s*(\d+[a-z]?)\s+(\d+[a-z]?)\s+(\d+)', t)
    if not m:
        return None
    via = f'{m.group(1)} {m.group(2)}'.upper() + (' S' if sur else '')
    return via, m.group(3).upper(), m.group(4)


def _consultar(where, limite=1):
    d = pedir(PLACAS, {'where': where, 'outFields': 'PDOTEXTO,PDONVIAL',
                       'returnGeometry': 'true', 'outSR': '4326',
                       'resultRecordCount': str(limite), 'f': 'json'})
    return d.get('features') or []


def _en_bogota(la, lo):
    return (BOGOTA_BBOX[0] <= la <= BOGOTA_BBOX[1]
            and BOGOTA_BBOX[2] <= lo <= BOGOTA_BBOX[3])


def geocodificar_bogota(direccion):
    """Devuelve (lat, lon, metodo) o None."""
    p = partir_direccion(direccion)
    if not p:
        return None
    via, n1, n2 = p
    # PDOTEXTO viene con un espacio al final ("78A 05 "), así que se compara
    # con LIKE y no con igualdad: con `=` no casa ni una sola placa.
    intentos = [(f"PDONVIAL='{via}' AND PDOTEXTO LIKE '{n1} {n2}%'", 'placa exacta')]
    # Avenida y calle se escriben distinto según quién digitó la dirección.
    alt = {'AC': 'CL', 'CL': 'AC', 'AK': 'KR', 'KR': 'AK'}.get(via.split()[0])
    if alt:
        via_alt = via.replace(via.split()[0], alt, 1)
        intentos.append((f"PDONVIAL='{via_alt}' AND PDOTEXTO LIKE '{n1} {n2}%'",
                         'placa exacta (vía alterna)'))
    for where, metodo in intentos:
        for f in _consultar(where):
            g = f.get('geometry') or {}
            if g and _en_bogota(g['y'], g['x']):
                return round(g['y'], 6), round(g['x'], 6), metodo

    # Sin placa exacta: la más cercana de la misma vía y el mismo primer
    # número. Es la puerta de al lado, no otra parte de la ciudad.
    try:
        objetivo = int(n2)
    except ValueError:
        return None
    mejor = None
    for f in _consultar(f"PDONVIAL='{via}' AND PDOTEXTO LIKE '{n1} %'", 60):
        txt = (f['attributes'].get('PDOTEXTO') or '').strip()
        m = re.match(r'^\S+\s+(\d+)', txt)
        g = f.get('geometry') or {}
        if not m or not g:
            continue
        dif = abs(int(m.group(1)) - objetivo)
        if dif <= MARGEN_PLACA and (mejor is None or dif < mejor[0]):
            if _en_bogota(g['y'], g['x']):
                mejor = (dif, round(g['y'], 6), round(g['x'], 6))
    if mejor:
        return mejor[1], mejor[2], f'placa vecina (±{mejor[0]})'
    return None


# Palabras demasiado comunes para confirmar que Nominatim entendió el sitio.
GENERICAS = {'centro', 'punto', 'acopio', 'fundacion', 'casa', 'parque',
             'comercial', 'ciudad', 'colombia', 'bogota', 'sede', 'plaza',
             'nacional', 'universidad', 'iglesia', 'comuna', 'barrio'}


def geocodificar_nombre(nombre, municipio):
    """Nominatim por NOMBRE, con las tres validaciones del Worker."""
    centro = CENTROS.get(norm(municipio))
    if not centro:
        return None
    consulta = f'{nombre}, {municipio}, Colombia'
    try:
        res = pedir(NOMINATIM, {'q': consulta, 'format': 'json', 'limit': '5',
                                'countrycodes': 'co', 'addressdetails': '1'})
    except Exception:
        return None
    distintivas = [p for p in norm(nombre).split()
                   if len(p) >= 5 and p not in GENERICAS]
    for r in res:
        la, lo = float(r['lat']), float(r['lon'])
        # 1 · dentro de 30 km del centro del municipio
        if abs(la - centro[0]) > 0.27 or abs(lo - centro[1]) > 0.27:
            continue
        # 2 · que no sea una vía: una calle entera no es una dirección
        if r.get('class') in ('highway', 'boundary', 'place', 'landuse'):
            continue
        # 3 · que el nombre devuelto se parezca al que buscamos
        texto = norm(r.get('display_name', ''))
        if distintivas and not any(p in texto for p in distintivas):
            continue
        return round(la, 6), round(lo, 6), 'nombre en OpenStreetMap'
    return None


def main():
    url = (f'https://docs.google.com/spreadsheets/d/{LIBRO}/export'
           f'?format=csv&gid={GID_PUBLICA}')
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        filas = list(csv.reader(io.StringIO(r.read().decode('utf-8'))))

    cab = filas[0]
    ix = {re.sub(r'[^a-z0-9 ]', '', norm(c)): i for i, c in enumerate(cab)}
    i_nom = ix.get('nombre', 0)
    i_mun = ix.get('ciudad o municipio', 1)
    # La columna se llama "DIRECCION NO SITIOS" en la hoja nueva.
    i_dir = next((i for k, i in ix.items() if k.startswith('direccion')), 3)
    i_la = next((i for k, i in ix.items() if k.startswith('latitud')), None)
    i_lo = next((i for k, i in ix.items() if k.startswith('longitud')), None)
    if i_la is None or i_lo is None:
        raise SystemExit('la hoja no tiene columnas LATITUD y LONGITUD')

    salida, cuenta, sin_punto = [], {}, []
    for f in filas[1:]:
        f = f + [''] * (len(cab) - len(f))
        nombre, muni = f[i_nom].strip(), f[i_mun].strip()
        if not nombre:
            continue
        if f[i_la].strip() and f[i_lo].strip():
            salida.append(f)
            cuenta['ya la tenía'] = cuenta.get('ya la tenía', 0) + 1
            continue

        direccion = f[i_dir].strip()
        r = None
        if norm(muni) == 'bogota' and direccion and norm(direccion) != 'sin dato':
            r = geocodificar_bogota(direccion)
        if not r:
            r = geocodificar_nombre(nombre, muni)
            time.sleep(1.1)          # cortesía con Nominatim (1 req/s)
        if r:
            f[i_la], f[i_lo] = str(r[0]), str(r[1])
            cuenta[r[2]] = cuenta.get(r[2], 0) + 1
        else:
            sin_punto.append(f'{nombre} · {muni} · {direccion[:40]}')
        salida.append(f)

    with open(SALIDA, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(cab)
        w.writerows(salida)

    total = len(salida)
    con = sum(1 for f in salida if f[i_la].strip())
    print(f'{con} de {total} con coordenada propia → {SALIDA.relative_to(RAIZ)}')
    for k, v in sorted(cuenta.items(), key=lambda x: -x[1]):
        print(f'   {v:>3}  {k}')
    if sin_punto:
        print(f'\n{len(sin_punto)} sin coordenada (siguen cayendo al centro del '
              f'municipio, marcados como aproximados):')
        for x in sin_punto:
            print('   ·', x)


if __name__ == '__main__':
    sys.exit(main())
