#!/usr/bin/env python3
"""Genera worker/src/centros.js — el centro de TODOS los municipios del país.

⚠️⚠️ POR QUÉ NO SE AMPLÍA `municipios.js` EN VEZ DE ESTO.

Esa tabla la usan dos cosas con requisitos OPUESTOS:

  · `inteligencia.js` la usa para DETECTAR municipios dentro de titulares de
    prensa. Ahí tiene que ser conservadora: 24 municipios ya quedaron fuera
    porque su nombre casa con países, estados de EE. UU. o palabras comunes
    (Sevilla, Florida, Bolívar), y meterle los 1.122 llenaría el conteo de
    notas ajenas. Además corre una expresión por nombre compuesto contra cada
    titular — su propio comentario dice que 118 × 1.500 ya aprieta el CPU del
    Worker.

  · `acopios.js` la usa para UBICAR un punto que no trajo coordenada. Ahí
    tiene que ser completa: un acopio en Mosquera, Popayán o Ibagué —los tres
    fuera de esa lista— quedaba invisible en el mapa, sin que nada lo dijera.

Son dos trabajos distintos con la misma tabla, así que se parten. Esta solo se
usa para ubicar; el detector de prensa no la ve.

Fuente: public/geo.json, que ya trae los 1.122 municipios con su centro
calculado por la mediana de sus puestos de votación.

    python3 tools/build_centros_js.py
"""
import json
import pathlib
import unicodedata
from collections import defaultdict

RAIZ = pathlib.Path(__file__).resolve().parent.parent
GEO = RAIZ / "public" / "geo.json"
SALIDA = RAIZ / "worker" / "src" / "centros.js"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.split())


def main() -> None:
    geo = json.loads(GEO.read_text(encoding="utf-8"))

    # clave "municipio|departamento" → [lat, lon], que es la llave sin ambigüedad
    # posible, y aparte el índice por nombre suelto para los que son únicos.
    por_par = {}
    por_nombre = defaultdict(list)

    for d in geo["d"]:
        dep = d["n"]
        for m in d.get("m", []):
            _, nombre, la, lo = m[0], m[1], m[2], m[3]
            if la is None or lo is None:
                continue
            # ⚠️ El nombre viene del padrón y trae rarezas de puntuación:
            # Bogotá figura como "Bogota. D.C." con punto en medio. Se indexa
            # tal cual Y en una forma sin puntuación, para que la hoja —que
            # escribe "Bogotá"— lo encuentre igual.
            for nom in {norm(nombre), norm(nombre.replace(".", " ")),
                        norm(nombre.split(".")[0])}:
                if not nom:
                    continue
                par = f"{nom}|{norm(dep)}"
                if par not in por_par:
                    por_par[par] = [round(la, 5), round(lo, 5)]
                por_nombre[nom].append((dep, round(la, 5), round(lo, 5)))

    # ⚠️ Un nombre que se repite entre departamentos NO entra al índice suelto.
    # Hay 200 y pico así ("Bolívar" existe en Cauca, Valle y Santander): sin el
    # departamento no hay forma de saber cuál es, y elegir uno al azar pondría
    # el acopio a cientos de kilómetros con pinta de exacto.
    unicos = {k: v[0] for k, v in por_nombre.items() if len(v) == 1}
    ambiguos = sorted(k for k, v in por_nombre.items() if len(v) > 1)

    def js(obj):
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

    cuerpo = f"""// GENERADO por tools/build_centros_js.py — no editar a mano.
//
// Centro de TODOS los municipios del país, para ubicar un acopio que no trajo
// coordenada propia.
//
// ⚠️⚠️ Esto NO es `municipios.js` y no debe fundirse con ella. Aquella sirve
// para DETECTAR municipios en titulares de prensa y es conservadora a
// propósito —24 nombres quedaron fuera por ambiguos y su propio comentario
// advierte del costo en CPU—; esta sirve para UBICAR y tiene que ser completa.
// Mezclarlas llenaría el conteo de prensa de notas ajenas.
//
// ⚠️ Un nombre que se repite entre departamentos NO entra al índice suelto:
// "Bolívar" existe en Cauca, Valle y Santander, y escoger uno pondría el punto
// a cientos de kilómetros con pinta de exacto. Esos solo se resuelven cuando
// la fila trae departamento.
//
// {len(por_par)} municipios · {len(unicos)} con nombre único · {len(ambiguos)} repetidos entre departamentos.

/** "municipio|departamento" normalizados → [lat, lon]. */
export const CENTRO_PAR = {js(por_par)};

/** "municipio" normalizado → [departamento, lat, lon], solo si es único. */
export const CENTRO_UNICO = {js(unicos)};

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
  .replace(/\\s+/g, ' ').trim();

/**
 * Centro del municipio. Devuelve [nombreDepto, lat, lon] o null.
 *
 * Con departamento resuelve siempre; sin él, solo los nombres que no se
 * repiten en el país. Prefiere no ubicar antes que ubicar mal.
 */
export function centroDe(municipio, departamento) {{
  const m = norm(municipio);
  if (!m) return null;
  const d = norm(departamento);
  if (d) {{
    const p = CENTRO_PAR[`${{m}}|${{d}}`];
    if (p) return [departamento, p[0], p[1]];
    // "Bogotá D.C." en la hoja contra "Bogotá D.C." del geo, y variantes.
    for (const alias of [d.replace(/\\bd\\.?\\s*c\\.?\\b/g, 'd.c.'), d.replace(/\\./g, '')]) {{
      const q = CENTRO_PAR[`${{m}}|${{alias}}`];
      if (q) return [departamento, q[0], q[1]];
    }}
  }}
  const u = CENTRO_UNICO[m];
  return u ? [u[0], u[1], u[2]] : null;
}}
"""
    SALIDA.write_text(cuerpo, encoding="utf-8")
    print(f"{SALIDA.relative_to(RAIZ)} · {len(por_par)} municipios "
          f"({len(unicos)} únicos, {len(ambiguos)} repetidos) · "
          f"{SALIDA.stat().st_size // 1024} KB")
    print("  repetidos, primeros 12:", ", ".join(ambiguos[:12]))


if __name__ == "__main__":
    main()
