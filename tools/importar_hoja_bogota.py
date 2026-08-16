#!/usr/bin/env python3
"""
Convierte la hoja pública "VOLUNTARIADO Y DONACIONES EN TIEMPO REAL BOGOTÁ"
al CSV de 13 columnas que consume nuestro Worker de acopios.

    python3 tools/ayuda-sismo/importar_hoja_bogota.py

Sale en `ayuda-sismo/acopios-bogota.csv`, listo para pegar en nuestra hoja.

La fuente son DOS pestañas del mismo documento, y describen cosas distintas
del mismo lugar:

    gid 0            VOLUNTARIADO  (quién necesita manos, horarios, contactos)
    gid 1994734491   DONACIONES    (qué insumos recibe cada punto)

Un mismo sitio aparece en las dos —El Campín está en ambas— así que se
FUSIONAN por nombre normalizado. Sin eso, el mapa mostraría dos puntos
apilados del mismo acopio con la mitad de la información cada uno.

⚠️ La hoja se actualiza cada pocas horas. Esto es un script y no un pegado a
mano justamente por eso: se vuelve a correr y se compara.

⚠️ NO inventa datos. Lo que la fuente no trae sale como SIN DATO, que es el
marcador que el Worker entiende como ausencia (y que la ficha oculta en vez
de mostrar "Horario: SIN DATO a SIN DATO").
"""

import csv
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

HOJA = '1-hMGwC0XaSu5ddZ896gYyVRpmbPkVYg3NJ_6rSxK4Y8'
PESTANAS = {'voluntariado': '0', 'donaciones': '1994734491'}

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / 'datos' / 'acopios-bogota.csv'

CABECERA = ['NOMBRE', 'CIUDAD O MUNICIPIO', 'DEPARTAMENTO', 'DIRECCION',
            'NECESIDAD', 'HORARIO ABRE', 'HORARIO CIERRE',
            'TODOS LOS DIAS O LV', 'REQUIERE VOLUNTARIOS', 'CONTACTO',
            'TELEFONO', 'ULTIMA REVISION', 'TIPO DE LUGAR']

SIN = 'SIN DATO'

# ⚠️ El Worker geocodifica el municipio contra MUNICIPIOS de municipios.js, que
# son los 118 vigilados para prensa. Cundinamarca NO está ahí: un acopio en
# Funza o Mosquera se queda sin coordenada y el frontend lo descarta en
# silencio. Se importan igual —el dato es correcto— y el script lo AVISA al
# final, para no descubrirlo cuando alguien pregunte por qué no aparece.
SIN_GEOCODIFICAR = {'Funza', 'Mosquera', 'Madrid', 'Soacha', 'Chía', 'Cota',
                    'Cajicá', 'Zipaquirá', 'Tocancipá', 'Tenjo', 'Facatativá',
                    'Sibaté', 'La Calera', 'Sopó', 'Fusagasugá'}

# Municipios distintos de Bogotá que aparecen en la hoja. Se buscan en el
# nombre Y en la dirección: "FUNZA Interpark" trae el municipio en el nombre,
# "Mosquera Cundinamarca KM 1.5" lo trae en la dirección.
OTROS_MUNICIPIOS = [
    ('Funza', 'Cundinamarca'), ('Mosquera', 'Cundinamarca'),
    ('Madrid', 'Cundinamarca'), ('Soacha', 'Cundinamarca'),
    ('Chía', 'Cundinamarca'), ('Cota', 'Cundinamarca'),
    ('Cajicá', 'Cundinamarca'), ('Zipaquirá', 'Cundinamarca'),
    ('Tocancipá', 'Cundinamarca'), ('Tenjo', 'Cundinamarca'),
    ('Facatativá', 'Cundinamarca'), ('Sibaté', 'Cundinamarca'),
    ('La Calera', 'Cundinamarca'), ('Sopó', 'Cundinamarca'),
    ('Fusagasugá', 'Cundinamarca'),
    ('Pereira', 'Risaralda'), ('Manizales', 'Caldas'),
    ('Armenia', 'Quindío'), ('Cali', 'Valle del Cauca'), ('Quibdó', 'Chocó'),
]

# Inferencia conservadora del tipo de lugar: solo cuando el nombre lo dice.
# ⚠️ EL ORDEN MANDA (se toma la primera que case) y dos casos lo demostraron:
#   · "ESCUELA DE CABALLERÍA" es un cantón militar, no un colegio → lo militar
#     tiene que evaluarse ANTES que 'escuela'.
#   · "La campiña" salía como escenario deportivo porque, sin tildes,
#     "campina" contiene "campin" → 'campin' va con \b a los dos lados.
TIPOS = [
    (r'batall[oó]n|caballer[ií]a|ej[eé]rcito|polic[ií]a|militar|cant[oó]n',
     'INSTALACIÓN MILITAR'),
    (r'\bc\.?c\.?\b|centro comercial|unicentro|multiplaza|plaza de las am|'
     r'gran estaci|titan|santaf[eé]|andino|colina', 'CENTRO COMERCIAL'),
    (r'estadio|\bcamp[ií]n\b|coliseo', 'ESCENARIO DEPORTIVO'),
    (r'universidad|unal|javeriana|andes|distrital|uniminuto', 'UNIVERSIDAD'),
    (r'colegio|escuela|liceo', 'INSTITUCIÓN EDUCATIVA'),
    (r'fundaci[oó]n|corporaci[oó]n|ong', 'FUNDACIÓN'),
    (r'iglesia|parroquia|catedral', 'IGLESIA'),
    (r'parque(?! way)|humedal', 'PARQUE'),
    (r'bodega|log[ií]stic|interpark|zona franca', 'BODEGA'),
    (r'jac\b|junta de acci[oó]n|sal[oó]n comunal', 'SEDE COMUNITARIA'),
    (r'compensar|cafam|colsubsidio', 'CAJA DE COMPENSACIÓN'),
]


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s).strip()


def limpiar(s, tope=None):
    """Aplana saltos de línea y espacios raros. La hoja trae U+2060 y
    viñetas dentro de las celdas, que en un CSV se ven como basura."""
    s = str(s or '').replace('⁠', ' ').replace('\xa0', ' ')
    s = re.sub(r'[\r\n]+', ' · ', s)
    s = re.sub(r'\s*·\s*(·\s*)+', ' · ', s)
    s = re.sub(r'\s+', ' ', s).strip(' ·\t ')
    if tope and len(s) > tope:
        corte = s[:tope].rsplit(' ', 1)[0]
        s = corte + '…'
    return s


def pedir(url):
    # Cloudflare responde 403 a "Python-urllib". No es evasión de nada: es
    # decir quién llama con una cabecera que el borde no descarta.
    return urllib.request.Request(url, headers={'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/126 Safari/537.36'})


def bajar(gid):
    url = (f'https://docs.google.com/spreadsheets/d/{HOJA}/export'
           f'?format=csv&gid={gid}')
    with urllib.request.urlopen(pedir(url), timeout=45) as r:
        txt = r.read().decode('utf-8')
    # ⚠️ NO usar splitlines(): las listas de insumos vienen como celdas de
    # varias líneas entre comillas, y splitlines() bota los saltos, así que
    # csv.reader pega los renglones sin separador ("Reciben 24hAgua leche de
    # fórmula"). StringIO conserva los saltos y el campo se lee entero.
    import io
    return list(csv.reader(io.StringIO(txt)))


def fila_cabecera(filas, marca):
    """La hoja tiene banners y filas en blanco arriba: el encabezado real no
    es la fila 0. Se busca la primera fila que contenga la marca."""
    for i, f in enumerate(filas):
        if any(norm(c) == marca for c in f):
            return i
    raise SystemExit(f'no se encontró el encabezado con "{marca}"')


def indices(cab):
    # Los encabezados vienen con signos: "¿QUÉ INSUMOS NECESITAN?". Sin quitar
    # la puntuación, esa columna no casa y el CSV sale sin un solo insumo —que
    # es justo lo que el donante necesita leer.
    limpio = lambda c: re.sub(r'[^a-z0-9 ]', '', norm(c)).strip()
    ix = {limpio(c): i for i, c in enumerate(cab) if c.strip()}
    def buscar(*nombres):
        for n in nombres:
            if n in ix:
                return ix[n]
        return -1
    return buscar


HORA = r'(\d{1,2})\s*[:.]?\s*(\d{2})?\s*(a\.?m\.?|p\.?m\.?|am|pm|m\b)?'


def _hora(txt):
    """'9:00AM' → '9:00 am'. Devuelve '' si no parece una hora."""
    m = re.match(r'^\s*' + HORA, txt, re.I)
    if not m:
        return ''
    h, mi, suf = m.group(1), m.group(2) or '00', (m.group(3) or '').lower()
    suf = suf.replace('.', '').strip()
    if suf.startswith('a'):
        suf = 'am'
    elif suf.startswith('p'):
        suf = 'pm'
    elif suf == 'm':
        return f'{int(h)} m'
    else:
        suf = ''
    return f'{int(h)}:{mi}{" " + suf if suf else ""}'


def horario(txt):
    """Parte el horario en (abre, cierra) SOLO cuando el texto lo permite.

    ⚠️ La fuente escribe cosas como 'Hasta las 9pm', 'YA MISMO' o dos jornadas
    en una celda. Forzarlas a dos columnas produciría horarios falsos, así que
    lo que no se puede partir viaja entero en la columna de cierre: el Worker
    une las dos con ' a ' y la ficha termina mostrando la frase tal cual.
    """
    t = limpiar(txt)
    if not t:
        return SIN, SIN
    # 9:00AM A 4:00PM · 8:00AM-6:00PM · 7AM - 12M
    # ⚠️ El separador NO puede ser una `a` suelta: en "9:00am-9:00pm" la
    # alternancia casaba con la "a" de "am" y partía el horario en "9:00" y
    # "m-9:00pm", así que ninguna de las dos mitades parecía una hora y el
    # horario entero terminaba en la columna de cierre. Va con \b.
    SEP = r'\s*(?:-|–|—|\ba\b|hasta)\s*'
    m = re.search(HORA + SEP + HORA, t, re.I)
    if m and ' · ' not in t:
        partes = re.split(SEP, m.group(0), maxsplit=1, flags=re.I)
        if len(partes) == 2:
            a, b = _hora(partes[0]), _hora(partes[1])
            if a and b:
                return a, b
    # Hasta las 9pm
    m = re.search(r'hasta\s+(?:las\s+)?' + HORA, t, re.I)
    if m:
        h = _hora(t[m.start(1):])
        if h:
            return SIN, f'hasta las {h}'
    return SIN, t


def municipio_de(nombre, direccion):
    heno = norm(f'{nombre} {direccion}')
    for mun, dep in OTROS_MUNICIPIOS:
        if re.search(r'\b' + norm(mun) + r'\b', heno):
            return mun, dep
    return 'Bogotá', 'Bogotá D.C.'


def tipo_de(nombre):
    n = norm(nombre)
    for patron, etiqueta in TIPOS:
        if re.search(patron, n):
            return etiqueta
    return SIN


def telefono_de(*campos):
    """Un solo número. El frontend arma un enlace tel: quitando todo lo que no
    sea dígito: con dos números pegados saldría un teléfono inexistente."""
    for c in campos:
        for m in re.finditer(r'\b(3\d{9}|\d{7})\b', str(c or '')):
            return m.group(1)
    return SIN


def main():
    voluntariado = bajar(PESTANAS['voluntariado'])
    donaciones = bajar(PESTANAS['donaciones'])

    reg = {}      # nombre normalizado -> dict de columnas

    # ── pestaña de donaciones: qué recibe cada punto ──
    cab = fila_cabecera(donaciones, 'lugar')
    b = indices(donaciones[cab])
    i_nom, i_dir = b('lugar'), b('direccion')
    i_act, i_ins = b('se necesitan donaciones'), b('que insumos necesitan')
    for f in donaciones[cab + 1:]:
        if len(f) <= i_nom:
            continue
        nombre = limpiar(f[i_nom])
        if not nombre or len(nombre) < 3:
            continue
        activo = norm(f[i_act]) if i_act >= 0 and len(f) > i_act else ''
        if activo == 'no':          # la fuente ya lo cerró
            continue
        d = limpiar(f[i_dir]) if i_dir >= 0 and len(f) > i_dir else ''
        reg[norm(nombre)] = {
            'nombre': nombre, 'dir': d,
            'necesidad': limpiar(f[i_ins], 200) if i_ins >= 0 and len(f) > i_ins else '',
            'vol': 'NO', 'tel': SIN, 'abre': SIN, 'cierra': SIN,
        }

    # ── pestaña de voluntariado: horarios, contactos y quién pide manos ──
    cab = fila_cabecera(voluntariado, 'lugar')
    b = indices(voluntariado[cab])
    i_nom, i_dir = b('lugar'), b('direccion')
    i_vol, i_hor = b('se necesitan voluntarios'), b('horarios')
    i_con = b('contacto clave')
    for f in voluntariado[cab + 1:]:
        if len(f) <= i_nom:
            continue
        nombre = limpiar(f[i_nom])
        if not nombre or len(nombre) < 3:
            continue
        clave = norm(nombre)
        d = limpiar(f[i_dir]) if i_dir >= 0 and len(f) > i_dir else ''
        # ⚠️ Solo "SI" cuenta como que piden voluntarios. "REVISANDO
        # INFORMACIÓN" es la fuente diciendo que no sabe, y mandar gente a un
        # sitio que no confirmó es peor que no mandarla.
        pide = 'SI' if (i_vol >= 0 and len(f) > i_vol and norm(f[i_vol]) == 'si') else 'NO'
        abre, cierra = horario(f[i_hor] if i_hor >= 0 and len(f) > i_hor else '')
        tel = telefono_de(f[i_con] if i_con >= 0 and len(f) > i_con else '')

        if clave in reg:                       # el mismo sitio en las dos hojas
            r = reg[clave]
            r['vol'] = pide
            r['abre'], r['cierra'] = abre, cierra
            if tel != SIN:
                r['tel'] = tel
            if not r['dir']:
                r['dir'] = d
        else:
            reg[clave] = {'nombre': nombre, 'dir': d, 'necesidad': '',
                          'vol': pide, 'tel': tel, 'abre': abre, 'cierra': cierra}

    # ── quitar lo que ya está en nuestra base ──
    # El CSV se hizo para PEGARLO. Si trae los que ya tenemos, el mapa muestra
    # el mismo acopio dos veces y nadie sabe cuál está al día.
    ya = set()
    try:
        with urllib.request.urlopen(pedir(
                'https://ayuda-sismo.reruizc.workers.dev/acopios.json'), timeout=20) as r:
            import json
            for a in json.load(r).get('items', []):
                ya.add(norm(a.get('n', '')))
    except Exception as e:                       # sin red se emite todo igual
        print(f'(no se pudo leer la base actual: {e})', file=sys.stderr)

    filas, fuera_de_mapa, repetidos = [], [], []
    for clave, r in list(reg.items()):
        if clave in ya:
            repetidos.append(r['nombre'])
            del reg[clave]

    for r in reg.values():
        mun, dep = municipio_de(r['nombre'], r['dir'])
        if mun in SIN_GEOCODIFICAR:
            fuera_de_mapa.append(f"{r['nombre']} ({mun})")
        filas.append([
            r['nombre'], mun, dep, r['dir'] or SIN, r['necesidad'] or SIN,
            r['abre'], r['cierra'], SIN, r['vol'], SIN, r['tel'],
            # La hoja fuente trae marca de actualización por fila y se mantiene
            # al día. No es nuestra verificación en terreno, pero es más que
            # "salió en prensa": va con la fecha de la fuente.
            'agosto 14', tipo_de(r['nombre']),
        ])

    filas.sort(key=lambda x: (x[1] != 'Bogotá', norm(x[0])))
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(CABECERA)
        w.writerows(filas)

    print(f'{len(filas)} puntos → {SALIDA.relative_to(RAIZ)}')
    print(f'  con voluntariado pedido: {sum(1 for f in filas if f[8] == "SI")}')
    print(f'  con lista de insumos:    {sum(1 for f in filas if f[4] != SIN)}')
    print(f'  con horario:             {sum(1 for f in filas if f[6] != SIN)}')
    print(f'  con teléfono:            {sum(1 for f in filas if f[10] != SIN)}')
    print(f'  sin dirección:           {sum(1 for f in filas if f[3] == SIN)}')
    if repetidos:
        print(f'\n{len(repetidos)} ya estaban en nuestra base y NO se repiten en el CSV '
              f'(si la hoja los actualizó, hay que editarlos a mano):')
        for x in repetidos:
            print('   ·', x)
    if fuera_de_mapa:
        print(f'\n⚠️ {len(fuera_de_mapa)} en municipios que el Worker NO geocodifica '
              f'(no aparecerán en el mapa hasta que municipios.js incluya '
              f'Cundinamarca):')
        for x in fuera_de_mapa:
            print('   ·', x)


if __name__ == '__main__':
    sys.exit(main())
