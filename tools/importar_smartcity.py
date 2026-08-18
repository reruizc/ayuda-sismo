#!/usr/bin/env python3
"""
Trae los puntos de acopio del mapa de emergencia de GISCALE Ingeniería
(smartcity.giscaleingenieria.com/terremoto) a nuestro CSV de 13 columnas.

    python3 tools/ayuda-sismo/importar_smartcity.py

Sale en `ayuda-sismo/acopios-smartcity.csv`.

Su API pública devuelve 676 puntos, pero la mayoría son de RESCATE (dónde hace
falta gente removiendo escombros), que no es lo mismo que un centro de acopio.
Se traen solo los tipos que alguien con un mercado en el carro puede usar:
acopio, albergue, salud, cocina y agua.

⚠️⚠️ **Son datos sin verificar y hay que publicarlos como tales.** De los 150
que sirven, la fuente marca 4 como verificados: el resto los cargó gente por su
app (`fuente: "app"`). Por eso todos salen con ULTIMA REVISION vacía, que en
nuestra ficha se ve como el sello ámbar "sin revisar". Ponerles fecha de
revisión sería decir que alguien confirmó algo que nadie confirmó.

⚠️ La fuente NO trae municipio: trae coordenada. El municipio se resuelve por
PUNTO EN POLÍGONO contra los mapas municipales que ya están en el repo, no por
"el centro más cercano" —que en el área metropolitana manda el norte de Suba a
Chía y el sur de Bogotá a Soacha—.
"""

import csv
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

API = 'https://mapa-emergencia.artefactofilms.workers.dev/api/snapshot'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126 Safari/537.36')

RAIZ = Path(__file__).resolve().parents[1]
GEO = Path(os.environ.get('DATOS', Path.home() / 'ricardoruiz.co')) / 'Bases de datos' / 'output_pacto_1v_2026' / 'geo' / 'mps'
SALIDA = RAIZ / 'datos' / 'acopios-smartcity.csv'

CABECERA = ['NOMBRE', 'CIUDAD O MUNICIPIO', 'DEPARTAMENTO', 'DIRECCION',
            'NECESIDAD', 'HORARIO ABRE', 'HORARIO CIERRE',
            'TODOS LOS DIAS O LV', 'REQUIERE VOLUNTARIOS', 'CONTACTO',
            'TELEFONO', 'ULTIMA REVISION', 'TIPO DE LUGAR', 'LATITUD', 'LONGITUD']

SIN = 'SIN DATO'
TIPOS_UTILES = {'acopio', 'albergue', 'salud', 'cocina', 'agua'}
ESTADOS_MUERTOS = {'descartado', 'cerrado'}

# Su vocabulario de tipo → el nuestro (columna TIPO DE LUGAR).
TIPO_NUESTRO = {'acopio': 'PUNTO DE ACOPIO', 'albergue': 'ALBERGUE',
                'salud': 'HOSPITAL', 'cocina': 'COCINA COMUNITARIA',
                'agua': 'PUNTO DE AGUA'}

# Nombres de departamento del GeoJSON → como los escribe nuestra hoja.
DEP_NOMBRE = {
    'BOGOTÁ, D.C.': 'Bogotá D.C.', 'BOGOTA, D.C.': 'Bogotá D.C.',
    'VALLE DEL CAUCA': 'Valle del Cauca', 'NORTE DE SANTANDER': 'Norte de Santander',
    'SAN ANDRÉS PROVIDENCIA Y SANTA CATALINA': 'San Andrés',
}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s).strip()


# El GeoJSON trae el nombre oficial del DANE; nuestra hoja usa el de uso
# corriente. Sin esta tabla, Cali aparecería como "Santiago de Cali" al lado de
# las filas que ya dicen "Cali" y se leerían como dos ciudades distintas.
NOMBRE_USO = {
    'santiago de cali': 'Cali', 'bogota, d.c.': 'Bogotá',
    'guadalajara de buga': 'Buga', 'cartagena de indias': 'Cartagena',
    'san juan de pasto': 'Pasto',
}
CONECTORES = {'de', 'del', 'la', 'las', 'los', 'y', 'el'}


def titulo(s):
    """MEDELLÍN → Medellín. Los conectores van en minúscula ('Guadalajara de
    Buga', no 'Guadalajara DE Buga') y las siglas de 2-3 letras se respetan."""
    partes = []
    for i, p in enumerate(str(s).split()):
        b = p.lower()
        if i and b in CONECTORES:
            partes.append(b)
        elif len(p) <= 3 and p.isupper() and b not in CONECTORES:
            partes.append(p)
        else:
            partes.append(p.capitalize())
    return ' '.join(partes)


def nombre_municipio(oficial):
    t = titulo(oficial)
    return NOMBRE_USO.get(norm(t).replace('  ', ' '), t)


def en_poligono(lon, lat, anillos):
    """Ray casting. Se implementa a mano para no depender de shapely: son
    veinte líneas y este script tiene que poder correr en cualquier parte."""
    dentro = False
    for i, anillo in enumerate(anillos):
        cruces = 0
        n = len(anillo)
        for j in range(n):
            x1, y1 = anillo[j][0], anillo[j][1]
            x2, y2 = anillo[(j + 1) % n][0], anillo[(j + 1) % n][1]
            if (y1 > lat) != (y2 > lat):
                xx = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
                if xx > lon:
                    cruces += 1
        # El primer anillo es el contorno; los siguientes son huecos.
        if i == 0:
            dentro = cruces % 2 == 1
            if not dentro:
                return False
        elif cruces % 2 == 1:
            return False
    return dentro


def cargar_municipios():
    """[(minlon,minlat,maxlon,maxlat, nombre, depto, anillos)] de todo el país."""
    # Sin los mapas municipales, TODOS los puntos saldrían "sin municipio" y el
    # CSV quedaría vacío sin decir por qué. Mejor parar y explicar dónde van.
    if not GEO.is_dir():
        raise SystemExit(
            f'No encuentro los mapas municipales en {GEO}\n'
            'Este script necesita los GeoJSON por departamento. Apunta la\n'
            'variable DATOS al repo que los tiene:\n'
            '  DATOS=~/ricardoruiz.co python3 tools/importar_smartcity.py')
    out = []
    for archivo in sorted(GEO.glob('[0-9][0-9].json')):
        d = json.loads(archivo.read_text(encoding='utf-8'))
        for f in d.get('features', []):
            g = f.get('geometry') or {}
            p = f.get('properties') or {}
            if g.get('type') == 'Polygon':
                partes = [g['coordinates']]
            elif g.get('type') == 'MultiPolygon':
                partes = g['coordinates']
            else:
                continue
            dep = DEP_NOMBRE.get(p.get('dpto_cnmbr', ''), titulo(p.get('dpto_cnmbr', '')))
            mun = nombre_municipio(p.get('mpio_cnmbr', ''))
            for anillos in partes:
                xs = [c[0] for c in anillos[0]]
                ys = [c[1] for c in anillos[0]]
                out.append((min(xs), min(ys), max(xs), max(ys), mun, dep, anillos))
    return out


def municipio_de(lat, lon, muns):
    for x0, y0, x1, y1, mun, dep, anillos in muns:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and en_poligono(lon, lat, anillos):
            return mun, dep
    return None, None


def base_actual():
    """Nombres y coordenadas de lo que ya tenemos, para no duplicar."""
    nombres, puntos = set(), []
    try:
        req = urllib.request.Request(
            'https://ayuda-sismo.reruizc.workers.dev/acopios.json',
            headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            for a in json.load(r).get('items', []):
                nombres.add(norm(a.get('n', '')))
                if a.get('la') is not None and not a.get('ap'):
                    puntos.append((a['la'], a['lo']))
    except Exception as e:
        print(f'(no se pudo leer la base actual: {e})', file=sys.stderr)
    return nombres, puntos


def main():
    req = urllib.request.Request(API, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        snap = json.load(r)

    utiles = [p for p in snap.get('puntos', [])
              if p.get('tipo') in TIPOS_UTILES
              and p.get('estado') not in ESTADOS_MUERTOS
              and p.get('lat') and p.get('lng')]

    muns = cargar_municipios()
    ya_nombres, ya_puntos = base_actual()

    filas, sin_mun, repetidos = [], [], []
    for p in utiles:
        nombre = re.sub(r'\s+', ' ', str(p.get('nombre') or '')).strip()
        if not nombre:
            continue
        if norm(nombre) in ya_nombres:
            repetidos.append(nombre)
            continue
        lat, lon = round(float(p['lat']), 6), round(float(p['lng']), 6)
        # A menos de ~120 m de algo que ya tenemos con punto propio: es el mismo
        # sitio con otro nombre. 0.0011° de latitud ≈ 120 m.
        if any(abs(lat - a) < 0.0011 and abs(lon - b) < 0.0011 for a, b in ya_puntos):
            repetidos.append(f'{nombre} (por cercanía)')
            continue

        mun, dep = municipio_de(lat, lon, muns)
        if not mun:
            sin_mun.append(f'{nombre} ({lat}, {lon})')
            continue

        nec = [str(x).strip() for x in (p.get('necesidades') or []) if str(x).strip()]
        tel = ''
        m = re.search(r'\b3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b|\b3\d{9}\b',
                      str(p.get('contacto') or ''))
        if m:
            tel = re.sub(r'[^\d]', '', m.group(0))
        # El estado "urgente"/"necesita" es de ELLOS y habla de si les falta
        # gente, no de si reciben donaciones: no se traduce a REQUIERE
        # VOLUNTARIOS, que en nuestra hoja significa otra cosa.
        filas.append([
            nombre, mun, dep,
            re.sub(r'\s+', ' ', str(p.get('direccion') or '')).strip() or SIN,
            ' · '.join(nec)[:200] or SIN,
            SIN, SIN, SIN,
            'SI' if (p.get('voluntarios_faltan') or 0) > 0 else 'NO',
            SIN, tel or SIN,
            # Vacío a propósito: la fuente marca 4 de 150 como verificados.
            '',
            TIPO_NUESTRO.get(p.get('tipo'), SIN),
            str(lat), str(lon),
        ])

    filas.sort(key=lambda x: (x[2], x[1], norm(x[0])))
    with open(SALIDA, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(CABECERA)
        w.writerows(filas)

    import collections
    print(f'{len(filas)} puntos nuevos → {SALIDA.relative_to(RAIZ)}')
    print('  por ciudad:', collections.Counter(f[1] for f in filas).most_common(10))
    print('  por tipo:  ', collections.Counter(f[12] for f in filas).most_common())
    print(f'  con necesidades listadas: {sum(1 for f in filas if f[4] != SIN)}')
    print(f'  con teléfono:             {sum(1 for f in filas if f[10] != SIN)}')
    if repetidos:
        print(f'\n{len(repetidos)} ya los teníamos, no se repiten:')
        for x in repetidos[:12]:
            print('   ·', x)
    if sin_mun:
        print(f'\n{len(sin_mun)} con coordenada fuera de todo municipio '
              f'(mar, frontera o error de digitación):')
        for x in sin_mun[:8]:
            print('   ·', x)


if __name__ == '__main__':
    sys.exit(main())
