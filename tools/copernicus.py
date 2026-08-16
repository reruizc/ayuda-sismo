#!/usr/bin/env python3
"""
Lee la activación de Copernicus EMS y resume el daño evaluado desde satélite.

Sirve para dos cosas:

  1. VERIFICAR ANTES DE DESPLEGAR. Imprime lo que va a publicar el Worker —
     cuántos edificios por grado, por zona, cuántos bloqueos de vía— sin tocar
     producción. Si una cifra se ve rara, se ve acá y no en el mapa en vivo.
  2. Probar el mapa en local: con `--json public/copernicus.json` deja el mismo
     archivo que sirve el Worker en `/copernicus.json`.

La lógica es gemela de `worker/src/copernicus.js`. Si se cambia una regla ahí
(qué grados entran, cómo se descartan las entregas repetidas), hay que cambiarla
acá también o los dos dejarán de decir lo mismo.

Sin dependencias. Uso:

    python3 tools/copernicus.py
    python3 tools/copernicus.py --json public/copernicus.json
    python3 tools/copernicus.py --codigo EMSR917      # otra activación
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

API = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/'
UA = {'User-Agent': 'MapaDeAyuda/1.0 (+https://reconstruyocolombia.com)'}

# Solo estos grados se publican. "No visible damage" son decenas de miles de
# rasgos intactos y "Not Analysed" es justamente lo que nadie miró.
GRADO = {'Destroyed': 3, 'Damaged': 2, 'Possibly damaged': 1}
ETIQUETA = {3: 'destruido', 2: 'dañado', 1: 'posiblemente dañado'}

NOMBRE_ES = {
    'Western Colombia': 'Occidente de Colombia',
    'Northern Cali': 'Cali · norte',
    'Cali Center': 'Cali · centro',
    'Quibdo Centre': 'Quibdó · centro',
}


def traer(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def tipo_es(obj):
    t = (obj or '').lower()
    if 'residential' in t and 'non-residential' not in t:
        return 'vivienda'
    if any(k in t for k in ('school', 'university', 'research')):
        return 'educativo'
    if any(k in t for k in ('medical', 'health', 'hospital')):
        return 'salud'
    if 'non-residential' in t:
        return 'no residencial'
    return 'edificación'


def anillo(wkt):
    m = re.search(r'\(\(([^)]+)\)\)', wkt or '')
    if not m:
        return None
    pts = []
    for par in m.group(1).split(','):
        try:
            lo, la = (float(x) for x in par.split())
        except ValueError:
            return None
        pts.append([round(la, 6), round(lo, 6)])
    return pts if len(pts) > 2 else None


def ultima_entrega_por_zona(aois):
    """Una entrega por zona: la más reciente.

    Sin esto Buenaventura entra dos veces (producto inicial y monitoreo) y el
    total cuenta los mismos edificios dos veces.
    """
    for aoi in aois or []:
        entregados = [p for p in (aoi.get('products') or [])
                      if (p.get('version') or {}).get('statusCode') == 'F' and p.get('layers')]
        if not entregados:
            continue
        entregados.sort(
            key=lambda p: ((p.get('version') or {}).get('deliveryTime') or '',
                           p.get('monitoringNumber') or 0),
            reverse=True)
        yield aoi, entregados[0], len(entregados) - 1


def recolectar(codigo):
    act = (traer(f'{API}?code={codigo}').get('results') or [None])[0]
    if not act:
        sys.exit(f'la activación {codigo} no devolvió resultados')
    bucket = (act.get('aws_bucket') or '').rstrip('/')
    if not bucket:
        sys.exit('la activación no trae bucket de vectores')

    zonas, danos, bloqueos, vias, fallos = [], [], [], [], []

    for aoi, prod, descartadas in ultima_entrega_por_zona(act.get('aois')):
        iz = len(zonas)
        cuenta = {3: 0, 2: 0, 1: 0}
        bloq = tramos = 0

        for capa in prod.get('layers') or []:
            if capa.get('format') != 'vt':
                continue
            nombre = capa.get('name') or ''
            edificio = '_builtUpP_' in nombre
            via = '_transportationL_' in nombre
            bloqueo = '_ancillaryCrisisInfoP_' in nombre
            if not (edificio or via or bloqueo):
                continue
            url = f"{bucket}/{re.sub(r'_VT$', '', nombre)}.json"
            try:
                fc = traer(url)
            except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
                fallos.append(f"{aoi['name']}: {nombre.split('/')[-1]} ({e})")
                continue

            for f in fc.get('features') or []:
                p, g = f.get('properties') or {}, f.get('geometry') or {}
                grado = GRADO.get(p.get('damage_gra'))
                if edificio and g.get('type') == 'Point':
                    if not grado:
                        continue
                    lo, la = g['coordinates'][:2]
                    danos.append([round(la, 6), round(lo, 6), grado, iz, tipo_es(p.get('obj_type'))])
                    cuenta[grado] += 1
                elif bloqueo and g.get('type') == 'Point':
                    lo, la = g['coordinates'][:2]
                    bloqueos.append([round(la, 6), round(lo, 6), iz])
                    bloq += 1
                elif via and grado:
                    lineas = (g['coordinates'] if g.get('type') == 'MultiLineString'
                              else [g['coordinates']] if g.get('type') == 'LineString' else [])
                    for l in lineas:
                        vias.append([[[round(la, 6), round(lo, 6)] for lo, la in l], iz])
                        tramos += 1

        pob = ((prod.get('stats') or {}).get('Estimated population') or {}).get('None', {}).get('total')
        zonas.append({
            'n': NOMBRE_ES.get(aoi['name'], aoi['name']),
            'num': aoi.get('number'),
            'entregado': (prod.get('version') or {}).get('deliveryTime'),
            'monitoreo': prod.get('monitoringNumber') or 0,
            'pob': pob if isinstance(pob, int) else None,
            'poly': anillo(aoi.get('extent')),
            'destruidos': cuenta[3], 'danados': cuenta[2], 'posibles': cuenta[1],
            'bloqueos': bloq, 'vias': tramos,
            '_descartadas': descartadas,
        })

    pendientes = sum(
        1 for a in act.get('aois') or []
        if not any((p.get('version') or {}).get('statusCode') == 'F' for p in a.get('products') or []))

    return {
        'activacion': codigo,
        'nombre': act.get('name') or '',
        'evento': act.get('eventTime'),
        'fuente': f'https://mapping.emergency.copernicus.eu/activations/{codigo}/',
        'informe': act.get('reportLink'),
        'credito': f'© Unión Europea, Copernicus Emergency Management Service ({codigo})',
        'ultima_entrega': max((z['entregado'] for z in zonas if z['entregado']), default=None),
        'zonas_pendientes': pendientes,
        'total': {
            'destruidos': sum(1 for d in danos if d[2] == 3),
            'danados': sum(1 for d in danos if d[2] == 2),
            'posibles': sum(1 for d in danos if d[2] == 1),
            'bloqueos': len(bloqueos), 'vias': len(vias), 'zonas': len(zonas),
        },
        'zonas': zonas, 'danos': danos, 'bloqueos': bloqueos, 'vias': vias,
        'fallos': fallos,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--codigo', default='EMSR916')
    ap.add_argument('--json', metavar='RUTA', help='guarda el archivo que sirve el Worker')
    a = ap.parse_args()

    d = recolectar(a.codigo)
    t = d['total']

    print(f"\n{d['activacion']} · {d['nombre']}")
    print(f"evento {d['evento']} · última entrega {d['ultima_entrega']}")
    print(f"\n{'zona':22s} {'destr':>6s} {'dañad':>6s} {'posib':>6s} {'bloq':>5s} {'vías':>5s}  población")
    print('─' * 74)
    for z in d['zonas']:
        extra = f"  (se descartaron {z['_descartadas']} entregas anteriores)" if z['_descartadas'] else ''
        pob = f"{z['pob']:,}".replace(',', '.') if z['pob'] else '—'
        print(f"{z['n'][:22]:22s} {z['destruidos']:6d} {z['danados']:6d} {z['posibles']:6d} "
              f"{z['bloqueos']:5d} {z['vias']:5d}  {pob}{extra}")
    print('─' * 74)
    print(f"{'TOTAL':22s} {t['destruidos']:6d} {t['danados']:6d} {t['posibles']:6d} "
          f"{t['bloqueos']:5d} {t['vias']:5d}")

    if d['zonas_pendientes']:
        print(f"\n⚠️  {d['zonas_pendientes']} zona(s) pedida(s) sin entregar todavía.")
    print('⚠️  Solo se analizaron estas manchas urbanas. Que un municipio no')
    print('    aparezca NO quiere decir que no tenga daño: quiere decir que')
    print('    nadie lo ha mirado desde satélite.')
    if d['fallos']:
        print('\nCapas que no se pudieron leer:')
        for f in d['fallos']:
            print('  ·', f)

    if a.json:
        with open(a.json, 'w', encoding='utf-8') as fh:
            json.dump({**d, 'generado': 0}, fh, ensure_ascii=False, separators=(',', ':'))
        import os
        print(f"\n→ {a.json} ({os.path.getsize(a.json) / 1024:.0f} KB)")


if __name__ == '__main__':
    main()
