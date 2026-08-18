#!/usr/bin/env python3
"""Re-emite los CSV de acopios con el esquema vigente de la hoja.

La hoja creció a 13 columnas (se agregaron TELEFONO, ULTIMA REVISION y TIPO DE
LUGAR) y usa "SIN DATO" en vez de celdas vacías. Este script toma los CSV que
ya generamos y los reescribe con ese esquema, en vez de editar 38 filas a mano.

⚠️ ULTIMA REVISION se deja en SIN DATO A PROPÓSITO. Esa columna significa
"alguien confirmó que sigue abierto"; ninguno de estos acopios ha sido
verificado en terreno —salieron de notas de prensa— y ponerle una fecha sería
afirmar una revisión que nadie hizo. Quien confirme, la escribe.

Correr:  python3 tools/ayuda-sismo/rehacer_csv_acopios.py
"""
import csv
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(REPO, "ayuda-sismo")

# Orden exacto de la hoja al 14-ago-2026. Si allá se reordena o se agrega una
# columna, hay que reflejarlo acá: el CSV se pega tal cual bajo el encabezado.
COLUMNAS = [
    "NOMBRE", "CIUDAD O MUNICIPIO", "DEPARTAMENTO", "DIRECCION", "NECESIDAD",
    "HORARIO ABRE", "HORARIO CIERRE", "TODOS LOS DIAS O LV",
    "REQUIERE VOLUNTARIOS", "CONTACTO", "TELEFONO", "ULTIMA REVISION",
    "TIPO DE LUGAR",
]

VACIO = "SIN DATO"

# Tipo de lugar deducido del nombre. Sirve para saber si se está donando a una
# entidad pública, a una fundación o a un privado, que es justo lo que la
# columna quiere responder.
def tipo_de_lugar(nombre, necesidad):
    n = nombre.lower()
    if "banco de sangre" in n or "hemocentro" in n:
        return "BANCO DE SANGRE"
    if "cruz roja" in n:
        return "CRUZ ROJA"
    if "banco de alimentos" in n or "arquidiocesano" in n or "saciar" in n:
        return "BANCO DE ALIMENTOS"
    if "universidad" in n or "eafit" in n or "universitaria" in n:
        return "UNIVERSIDAD"
    if "alcald" in n or "gobernaci" in n:
        return "ENTIDAD PUBLICA"
    if "biblioteca" in n or "coliseo" in n or "plazoleta" in n or "canchas" in n:
        return "ESPACIO PUBLICO"
    if "terminal" in n or "centro comercial" in n or "unicentro" in n:
        return "PRIVADO"
    if n.startswith("café") or n.startswith("cafe"):
        # Los "Café" de Pereira son sedes comunitarias de barrio, no cafeterías.
        return "SEDE COMUNITARIA"
    if "bomberos" in n:
        return "CUERPO DE SOCORRO"
    if "fundaci" in n:
        return "FUNDACION PRIVADA"
    return VACIO


def rehacer(ruta):
    with open(ruta, encoding="utf-8") as fh:
        filas = list(csv.reader(fh))
    if not filas:
        return 0
    viejo = filas[0]
    idx = {h: i for i, h in enumerate(viejo)}

    salida = [COLUMNAS]
    for f in filas[1:]:
        if not any(c.strip() for c in f):
            continue
        def g(col):
            i = idx.get(col, -1)
            v = f[i].strip() if 0 <= i < len(f) else ""
            return v if v else VACIO

        nombre = g("NOMBRE")
        fila = [
            nombre, g("CIUDAD O MUNICIPIO"), g("DEPARTAMENTO"), g("DIRECCION"),
            g("NECESIDAD"), g("HORARIO ABRE"), g("HORARIO CIERRE"),
            g("TODOS LOS DIAS O LV"),
            # "NO" y no SIN DATO: ninguna de estas notas pedía voluntarios, y
            # dejarlo en blanco haría creer que no se sabe.
            g("REQUIERE VOLUNTARIOS") if g("REQUIERE VOLUNTARIOS") != VACIO else "NO",
            g("CONTACTO"),
            VACIO,                       # TELEFONO: la prensa no lo publicó
            VACIO,                       # ULTIMA REVISION: nadie ha verificado
            tipo_de_lugar(nombre, g("NECESIDAD")),
        ]
        salida.append(fila)

    with open(ruta, "w", encoding="utf-8", newline="") as fh:
        csv.writer(fh).writerows(salida)
    return len(salida) - 1


def main():
    for archivo in ("acopios-semilla-prensa.csv", "acopios-tanda-2.csv"):
        ruta = os.path.join(DIR, archivo)
        if not os.path.exists(ruta):
            print(f"  (falta {archivo})")
            continue
        n = rehacer(ruta)
        print(f"  {archivo:<30} {n:>3} filas · {len(COLUMNAS)} columnas")


if __name__ == "__main__":
    main()
