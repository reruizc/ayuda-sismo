#!/usr/bin/env python3
"""Índice liviano de barrios para el formulario de ayuda-sismo.

Extrae nombre + comuna + centroide de los GeoJSON de barrios que ya tenemos
para las ciudades con daño estructural del sismo del 10-ago-2026.

⚠️ Armenia NO tiene capa de barrios en el repo (ver LEEME.md). Quien reporte
   desde allá usa el pin libre en el mapa; el formulario lo dice explícito.

Salida: ayuda-sismo/public/barrios.json  (~60 KB, se sirve estático)
    { "cali": {"n": "Cali", "c": [lat, lon], "b": [["Barrio", "Comuna", lat, lon], ...]} }

Correr:  python3 tools/ayuda-sismo/build_barrios.py
"""
import json
import os
import sys
import unicodedata

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEO = os.path.join(REPO, "Bases de datos", "output_pacto_1v_2026", "geo")
OUT = os.path.join(REPO, "ayuda-sismo", "public", "barrios.json")

# clave -> (rótulo, archivo, campo_barrio, campo_comuna)
CIUDADES = {
    "cali":      ("Cali",      "CALI-BARRIOS.json",      "barrio",  "comuna"),
    "pereira":   ("Pereira",   "PEREIRA-BARRIOS.json",   "NOMBRE",  "COMUNA"),
    "manizales": ("Manizales", "MANIZALES-BARRIOS.json", "BARRIOS", "Id_Comuna"),
    "quibdo":    ("Quibdó",    "QUIBDO-BARRIOS.json",    "barrio",  "COMUNA"),
}

# Marcadores de nulo que traen las capas oficiales (no son barrios).
RUIDO = {"", "sn", "null", "none", "nan", "sin nombre", "no aplica", "-", "--"}


def titulo(s):
    """MAYÚSCULAS y minúsculas mezcladas conviven en las capas -> normalizar."""
    s = " ".join(str(s).split())
    if s.isupper() or s.islower():
        s = s.title()
    # 'Barrio De La Union' -> 'Barrio de la Unión' (solo las partículas)
    chicas = {"De", "Del", "La", "Las", "Los", "El", "Y", "A"}
    partes = s.split()
    return " ".join(
        p.lower() if i and p in chicas else p for i, p in enumerate(partes)
    )


def sin_tildes(s):
    return "".join(
        c for c in unicodedata.normalize("NFD", str(s).lower())
        if unicodedata.category(c) != "Mn"
    )


def _coords(geom):
    """Aplana cualquier anidamiento de Polygon/MultiPolygon a pares [lon, lat]."""
    out = []
    def rec(x):
        if (isinstance(x, (list, tuple)) and len(x) >= 2
                and all(isinstance(v, (int, float)) for v in x[:2])):
            out.append((x[0], x[1]))
            return
        if isinstance(x, (list, tuple)):
            for y in x:
                rec(y)
    rec(geom.get("coordinates") if geom else None)
    return out


def centroide(geom):
    """Centroide del bounding box: basta para soltar el pin dentro del barrio
    y evita depender de shapely (el pipeline es stdlib pura)."""
    pts = _coords(geom)
    if not pts:
        return None
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    lat = round((min(lats) + max(lats)) / 2, 5)
    lon = round((min(lons) + max(lons)) / 2, 5)
    # Sanidad: Colombia continental. Una capa mal proyectada se detecta acá
    # y no en el navegador con el pin en mitad del Atlántico.
    if not (-4.5 <= lat <= 13.8 and -80.0 <= lon <= -66.5):
        return None
    return [lat, lon]


def main():
    salida = {}
    for clave, (rotulo, archivo, campo_b, campo_c) in CIUDADES.items():
        ruta = os.path.join(GEO, archivo)
        if not os.path.exists(ruta):
            print(f"  ⚠️  falta {archivo} — {rotulo} queda sin selector de barrio")
            continue

        with open(ruta, encoding="utf-8") as fh:
            data = json.load(fh)

        vistos, filas = set(), []
        lats, lons = [], []
        for feat in data.get("features", []):
            props = feat.get("properties") or {}
            nombre = props.get(campo_b)
            if nombre is None or sin_tildes(nombre).strip() in RUIDO:
                continue
            cen = centroide(feat.get("geometry"))
            if not cen:
                continue

            nombre = titulo(nombre)
            comuna = props.get(campo_c) or ""
            comuna = " ".join(str(comuna).split())
            if comuna.isdigit():
                comuna = f"Comuna {int(comuna)}"
            elif comuna and not sin_tildes(comuna).startswith("comuna"):
                comuna = titulo(comuna)

            # Un barrio puede venir en varios polígonos (islas, manzanas
            # sueltas): se queda el primero, no se duplica en el selector.
            llave = (sin_tildes(nombre), sin_tildes(comuna))
            if llave in vistos:
                continue
            vistos.add(llave)

            filas.append([nombre, comuna, cen[0], cen[1]])
            lats.append(cen[0])
            lons.append(cen[1])

        filas.sort(key=lambda r: sin_tildes(r[0]))
        salida[clave] = {
            "n": rotulo,
            "c": [round(sum(lats) / len(lats), 5), round(sum(lons) / len(lons), 5)],
            "b": filas,
        }
        print(f"  {rotulo:<10} {len(filas):>4} barrios")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, separators=(",", ":"))

    kb = os.path.getsize(OUT) / 1024
    print(f"\n→ {OUT}  ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
