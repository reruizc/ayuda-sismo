#!/usr/bin/env python3
"""Puntos de prueba para el mapa de ayuda.

Publica reportes de ejemplo contra el Worker para poder ver y tocar la página
con datos parecidos a los reales: las 3 familias de situación, varias
urgencias, capitales y municipios vecinos.

  python3 tools/ayuda-sismo/seed.py                      # contra localhost:8787
  python3 tools/ayuda-sismo/seed.py --api https://...    # contra el desplegado

⚠️ Los reportes de prueba llevan el prefijo [PRUEBA] en el título justamente
   para poder distinguirlos y borrarlos antes de abrir el sitio al público:

     npx wrangler d1 execute ayuda-sismo --remote \
       --command "DELETE FROM reportes WHERE titulo LIKE '[PRUEBA]%'"

   Nunca correr esto contra producción una vez haya reportes de verdad.
"""
import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEO = os.path.join(REPO, "ayuda-sismo", "public", "geo.json")

# (situación, municipio, depto, título, detalle, urgencia, personas, contacto_pub)
CASOS = [
    ("nec-rescate", "Pereira", "Risaralda",
     "Vecinos escuchan voces bajo la placa caída de un segundo piso",
     "Edificio de tres pisos en la carrera 8. Ya avisamos a bomberos pero no han llegado.",
     "alta", 3, True),
    ("nec-viveres", "Dosquebradas", "Risaralda",
     "Familia de 6 sin agua ni comida desde el lunes",
     "Estamos en la parte alta, el carrotanque no ha subido. Hay dos niños pequeños.",
     "alta", 6, True),
    ("nec-estructural", "Pereira", "Risaralda",
     "Muro medianero agrietado, amenaza la casa de al lado",
     "La grieta creció desde ayer. La casa vecina está habitada.",
     "alta", 0, True),
    ("busco-persona", "Manizales", "Caldas",
     "Buscamos a Marta Lucía, 62 años, barrio Chipre",
     "Salió el lunes a las 7 de la mañana. Estatura media, chaqueta verde. "
     "Cualquier informacion al 3205558899.",
     "alta", 1, True),   # el contacto se fuerza privado en el servidor
    ("busco-mascota", "Villamaria", "Caldas",
     "Perro criollo café, collar rojo, se perdió al evacuar",
     "Responde al nombre de Lucho. Es viejito y está medicado.",
     "media", 0, True),
    ("nec-salud", "Manizales", "Caldas",
     "Señora diabética sin insulina desde el lunes",
     "Necesita insulina NPH y no hay farmacia abierta en el sector.",
     "alta", 1, True),
    ("nec-refugio", "Cali", "Valle del Cauca",
     "Tres familias durmiendo en la calle tras evacuar el edificio",
     "Son 11 personas en total, incluidos 4 menores. Necesitamos techo esta noche.",
     "alta", 11, True),
    ("nec-servicios", "Yumbo", "Valle del Cauca",
     "La cuadra entera sin agua ni señal de celular",
     "Van tres días. Somos unas 40 casas.",
     "media", 40, False),
    ("nec-viveres", "Armenia", "Quindío",
     "Albergue improvisado en el coliseo necesita agua y colchonetas",
     "Estamos recibiendo gente desde el lunes. Falta agua potable sobre todo.",
     "alta", 80, True),
    ("nec-otro", "Calarca", "Quindío",
     "Necesitamos carpas y lonas para cubrir techos abiertos",
     "Las tejas se cayeron y está lloviendo en las noches.",
     "media", 25, True),
    ("nec-salud", "Quibdo", "Chocó",
     "Puesto de salud sin suero ni analgésicos",
     "Estamos atendiendo heridos leves con lo que queda.",
     "alta", 30, True),

    ("ofr-alojamiento", "Pereira", "Risaralda",
     "Tengo dos habitaciones disponibles para una familia",
     "Con baño y cocina. Puedo recibir hasta 5 personas por dos semanas.",
     "media", 5, True),
    ("ofr-viveres", "Cali", "Valle del Cauca",
     "Tenemos 40 mercados listos para entregar",
     "Los entregamos donde se necesiten, coordinamos transporte.",
     "media", 0, True),
    ("ofr-transporte", "Manizales", "Caldas",
     "Camioneta de estacas para mover donaciones",
     "Disponible todos los días después de las 2 p.m. Yo pongo la gasolina.",
     "baja", 0, True),
    ("ofr-voluntario", "Armenia", "Quindío",
     "Grupo de 6 personas con herramienta para remoción",
     "Tenemos palas, carretillas y cascos. Fines de semana completos.",
     "media", 6, True),
    ("ofr-mascota", "Dosquebradas", "Risaralda",
     "Encontré un gato gris con collar azul",
     "Lo tengo en mi casa, está bien y comiendo. Busco a su familia.",
     "baja", 0, True),
    ("ofr-persona", "Cali", "Valle del Cauca",
     "Señor mayor sin documentos en el puesto de salud",
     "No recuerda su dirección. Está estable y acompañado.",
     "alta", 1, True),   # contacto también forzado a privado
    ("ofr-salud", "Quibdo", "Chocó",
     "Soy enfermera, disponible en las tardes",
     "Puedo hacer curaciones y control de signos.",
     "media", 0, True),
]


def centros():
    """{(municipio_norm, depto_norm): (lat, lon)} desde el índice geográfico."""
    import unicodedata

    def n(s):
        return "".join(c for c in unicodedata.normalize("NFD", str(s).lower())
                       if unicodedata.category(c) != "Mn")

    if not os.path.exists(GEO):
        sys.exit("falta geo.json — corre antes: python3 tools/ayuda-sismo/build_geo.py")
    data = json.load(open(GEO, encoding="utf-8"))["d"]
    out = {}
    for d in data:
        for m in d["m"]:
            if m[2] is not None:
                out[(n(m[1]), n(d["n"]))] = (m[2], m[3])
    return out, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8787")
    ap.add_argument("--semilla", type=int, default=7)
    args = ap.parse_args()

    random.seed(args.semilla)          # reproducible: mismas posiciones cada corrida
    cent, n = centros()

    ok = err = 0
    for (sit, mun, dep, titulo, detalle, urg, personas, pub) in CASOS:
        base = cent.get((n(mun), n(dep)))
        if not base:
            print(f"  ⚠️  sin coordenada: {mun}, {dep} — omitido")
            err += 1
            continue
        # Dispersión de ~1,5 km alrededor del centro del municipio para que los
        # puntos no queden apilados en el mismo píxel.
        lat = round(base[0] + random.uniform(-.014, .014), 5)
        lon = round(base[1] + random.uniform(-.014, .014), 5)

        cuerpo = {
            "sit": sit, "urgencia": urg,
            "titulo": f"[PRUEBA] {titulo}",
            "detalle": detalle,
            "depto": dep, "municipio": mun, "barrio": "",
            "personas": personas or None,
            "lat": lat, "lon": lon,
            "contacto": "3105551234" if pub else "",
            "contacto_pub": pub,
        }
        # El Worker limita a 5 reportes por hora y por IP, así que sembrar 19
        # desde la misma máquina chocaría con su propia defensa. Se manda una
        # IP distinta por caso.
        #
        # Esto NO es un agujero: Cloudflare fija `CF-Connecting-IP` en el edge
        # y descarta el valor que mande el cliente, así que el truco solo
        # funciona contra `wrangler dev`, que es donde se siembra.
        ip_falsa = f"198.51.100.{(ok + err) % 250 + 1}"      # rango TEST-NET-2
        req = urllib.request.Request(
            f"{args.api}/reporte", method="POST",
            data=json.dumps(cuerpo).encode(),
            headers={"Content-Type": "application/json",
                     "CF-Connecting-IP": ip_falsa})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.loads(r.read())
            if d.get("ok"):
                ok += 1
                print(f"  ✓ {sit:<16} {mun:<12} {d['id']}")
            else:
                err += 1
                print(f"  ✗ {sit:<16} {mun:<12} {d}")
        except urllib.error.HTTPError as e:
            err += 1
            print(f"  ✗ {sit:<16} {mun:<12} HTTP {e.code} {e.read()[:120].decode(errors='replace')}")
        except Exception as e:                                   # noqa: BLE001
            err += 1
            print(f"  ✗ {sit:<16} {mun:<12} {e}")

    print(f"\n{ok} publicados · {err} con error")
    if err:
        sys.exit(1)


if __name__ == "__main__":
    main()
