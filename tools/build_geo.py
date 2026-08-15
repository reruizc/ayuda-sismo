#!/usr/bin/env python3
"""Índice geográfico departamento → municipio para ayuda-sismo.

El sismo no golpeó solo capitales: hay municipios alrededor de Cali, Pereira,
Manizales, Armenia y Quibdó tanto o más afectados. Este índice permite elegir
cualquiera de los 1.100+ municipios del país, no una lista de 5 ciudades.

Fuentes:
  - divipola.json      nombres y códigos oficiales (34 deptos · 1.189 muns)
  - PUESTOS_GEOREF.csv 13.508 puestos con lat/lon → centro de cada municipio

El centro se calcula con la MEDIANA de los puestos del municipio, no el
promedio: un solo puesto rural mal georreferenciado corre el promedio varios
kilómetros, y la mediana lo ignora.

Salida: ayuda-sismo/public/geo.json
  {"d":[{"c":"31","n":"Valle del Cauca","b":[latMin,lonMin,latMax,lonMax],
         "m":[["001","Cali",3.43,-76.52], ...]}]}

Correr:  python3 tools/ayuda-sismo/build_geo.py
"""
import csv
import json
import os
import statistics
import sys

AQUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(AQUI, "public", "geo.json")

# ⚠️ Las dos fuentes viven en el monorepo `ricardoruiz.co`, que NO se movió con
# este proyecto: son 6 MB de datos electorales que no tienen por qué viajar en
# el repo del mapa. Se puede apuntar a otra copia con la variable de entorno
# `DATOS_RR`. Al separar los repos estas rutas quedaron colgando de la carpeta
# vieja y el script escribía a un `geo.json` que ya no existía.
DATOS = os.environ.get("DATOS_RR") or os.path.expanduser("~/ricardoruiz.co/Bases de datos")
DIVIPOLA = os.path.join(DATOS, "test-presidencial", "divipola.json")
GEOREF = os.path.join(DATOS, "PUESTOS_GEOREF.csv")

# Colombia continental + San Andrés. Descarta consulados (depto 88) y filas
# con lat/lon corruptos, que en este CSV existen.
BBOX = (-4.3, 13.6, -82.0, -66.8)

# divipola.json trae los nombres de la Registraduría: sin tildes y algunos
# TRUNCADOS ("Norte De San", "Valle"). En una página pública eso se ve mal,
# así que los 33 departamentos se corrigen a mano — son pocos y muy visibles.
# Los municipios se dejan como vienen: son 1.122 y corregirlos a mano sería
# introducir erratas. La búsqueda del sitio ignora tildes, así que quien
# escriba "Quibdó" igual encuentra "Quibdo".
DEP_NOMBRES = {
    "Atlantico": "Atlántico", "Bogota D.C.": "Bogotá D.C.", "Bolivar": "Bolívar",
    "Boyaca": "Boyacá", "Caqueta": "Caquetá", "Choco": "Chocó",
    "Cordoba": "Córdoba", "Guainia": "Guainía", "Norte De San": "Norte de Santander",
    "Quindio": "Quindío", "San Andres": "San Andrés y Providencia",
    "Valle": "Valle del Cauca", "Vaupes": "Vaupés",
}

# Departamentos con daño estructural reportado. Se marcan por NOMBRE y no por
# código a propósito: los códigos de esta fuente son de la Registraduría
# (Caldas=09, no 17) y escribirlos de memoria es como se cuelan los errores
# silenciosos. El código sale del propio archivo.
#
# ⚠️ No son solo los del sismo: Nariño y Tolima entran por los INCENDIOS
# FORESTALES, que dejaron gente sin casa igual que el terremoto. El sitio
# atiende las dos emergencias —lo dice su propio encabezado— y quien perdió
# la casa en un incendio necesita el mismo formulario. Por eso la etiqueta
# del selector habla de "afectación reportada" y no de daño por sismo.
AFECTADOS = {"Valle del Cauca", "Risaralda", "Caldas", "Quindío", "Chocó",
             "Nariño", "Tolima"}


def leer_puestos():
    """{(dep, mun): [(lat, lon), ...]} desde el georreferenciado."""
    puntos = {}
    with open(GEOREF, encoding="utf-8-sig") as fh:
        for fila in csv.DictReader(fh, delimiter=";"):
            cod = (fila.get("CÓDIGO COMPLETO") or "").strip()
            if len(cod) != 9 or not cod.isdigit():
                continue
            dep, mun = cod[:2], cod[2:5]
            if dep == "88":                       # exterior / consulados
                continue
            try:
                lat = float((fila.get("LATITUD") or "").replace(",", "."))
                lon = float((fila.get("LONGITUD") or "").replace(",", "."))
            except ValueError:
                continue
            if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lon <= BBOX[3]):
                continue
            puntos.setdefault((dep, mun), []).append((lat, lon))
    return puntos


def main():
    for ruta in (DIVIPOLA, GEOREF):
        if not os.path.exists(ruta):
            sys.exit(f"falta {ruta}")

    puntos = leer_puestos()
    divi = json.load(open(DIVIPOLA, encoding="utf-8"))

    deptos, sin_coord = [], []
    for d in divi["deptos"]:
        dep = d["cod"]
        nombre = DEP_NOMBRES.get(d["nombre"], d["nombre"])
        muns, lats, lons = [], [], []
        for m in d.get("muns", []):
            pts = puntos.get((dep, m["cod"]))
            if not pts:
                # Se emite igual, sin coordenada: el municipio debe poder
                # elegirse aunque toque marcar el punto a mano en el mapa.
                sin_coord.append(f"{d['nombre']}/{m['nombre']}")
                muns.append([m["cod"], m["nombre"], None, None])
                continue
            lat = round(statistics.median(p[0] for p in pts), 5)
            lon = round(statistics.median(p[1] for p in pts), 5)
            muns.append([m["cod"], m["nombre"], lat, lon])
            lats.append(lat)
            lons.append(lon)

        muns.sort(key=lambda r: r[1])
        if not lats:
            continue
        # Margen para que el encuadre no deje los municipios del borde pegados.
        entrada = {
            "c": dep, "n": nombre,
            "b": [round(min(lats) - .12, 4), round(min(lons) - .12, 4),
                  round(max(lats) + .12, 4), round(max(lons) + .12, 4)],
            "m": muns,
        }
        if nombre in AFECTADOS:
            entrada["a"] = 1
        deptos.append(entrada)

    faltan = AFECTADOS - {d["n"] for d in deptos}
    if faltan:
        # Si un nombre de AFECTADOS deja de casar, la página perdería sus
        # accesos rápidos SIN avisar. Mejor que reviente el build.
        sys.exit(f"AFECTADOS no casa con el archivo: {sorted(faltan)}")

    deptos.sort(key=lambda x: x["n"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"d": deptos}, fh, ensure_ascii=False, separators=(",", ":"))

    total_m = sum(len(d["m"]) for d in deptos)
    print(f"  {len(deptos)} departamentos · {total_m} municipios")
    print(f"  sin coordenada: {len(sin_coord)}"
          + (f"  (ej.: {', '.join(sin_coord[:3])})" if sin_coord else ""))
    print(f"\n→ {OUT}  ({os.path.getsize(OUT)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
