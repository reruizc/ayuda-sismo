#!/usr/bin/env python3
"""Lista de municipios para el clasificador de prensa del Worker.

Emite `ayuda-sismo/worker/src/municipios.js` con los municipios de los
departamentos afectados más las ciudades grandes del país, para poder detectar
de qué municipio habla un titular.

⚠️⚠️ EL PROBLEMA CENTRAL SON LOS NOMBRES AMBIGUOS. Buscar "Sevilla" en un
titular trae noticias de España; "Florida" trae Estados Unidos; "Bolívar" y
"Córdoba" son también departamentos y un prócer. Detectarlos por texto produce
conteos inflados que se ven bien y son falsos.

La regla que se aplica: un nombre entra solo si es inequívoco en el contexto de
una noticia colombiana de sismo. Los ambiguos se EXCLUYEN y se declaran en la
página; es preferible no contar un municipio a atribuirle notas que no son
suyas. Los nombres compuestos largos ("San José del Palmar") sí entran, porque
la ambigüedad está en la forma corta.

Correr:  python3 tools/ayuda-sismo/build_municipios_js.py
"""
import json
import os
import unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEO = os.path.join(REPO, "ayuda-sismo", "public", "geo.json")
OUT = os.path.join(REPO, "ayuda-sismo", "worker", "src", "municipios.js")

# Departamentos con daño estructural reportado.
DEPTOS = {"Valle del Cauca", "Risaralda", "Caldas", "Quindío", "Chocó"}

# Ciudades grandes de fuera de esos departamentos que aparecen en la cobertura
# (sede de decisiones, destino de heridos, origen de donaciones).
EXTRA = {("01", "001"), ("16", "001"), ("03", "001"), ("05", "001"),
         ("27", "001"), ("19", "001"), ("23", "001")}

# Medido contra titulares reales: estos nombres NO se pueden detectar por texto
# sin ensuciar el conteo. Se excluyen a propósito.
AMBIGUOS = {
    "bolivar",      # departamento y prócer
    "cordoba",      # departamento
    "florida",      # estado de EE. UU.
    "sevilla",      # ciudad de España
    "argelia",      # país
    "palestina",    # territorio
    "versalles",    # ciudad de Francia
    "andes",        # cordillera
    "toro",         # sustantivo común
    "union",        # sustantivo común
    "la union",
    "la victoria",
    "la celia",
    "san jose",     # la forma corta; "San José del Palmar" sí entra
    "santa rosa",   # hay varias en el país
    "belen",
    "genova",       # ciudad de Italia
    "restrepo",     # apellido frecuente
    "obando",       # apellido
    "salento",      # se confunde con Salento (Italia) en cobertura de turismo
    "buga",         # también "el señor de Buga" en notas religiosas
    "el aguila",    # ave
    "el cairo",     # capital de Egipto
    "la merced",
    "la virginia",  # estado de EE. UU.
    "guacari",
    "supia",
    "risaralda",    # hay un municipio Risaralda en Caldas, choca con el depto
    "quindio",      # ídem
}


# Nombre para MOSTRAR. La fuente los trae sin tildes y con las partículas en
# mayúscula ("Belen De Umbria", "Bogota. D.C."). En geo.json se dejaron así
# porque son 1.122 y corregirlos a mano sería meter erratas; acá son 108 y
# todos pueden salir en pantalla, así que sí se curan. La llave de búsqueda
# NO cambia: sigue siendo la forma sin tildes.
DISPLAY = {
    "acandi": "Acandí", "alcala": "Alcalá", "alto baudo": "Alto Baudó",
    "andalucia": "Andalucía", "apia": "Apía", "aranzazu": "Aránzazu",
    "bagado": "Bagadó", "bahia solano": "Bahía Solano", "bajo baudo": "Bajo Baudó",
    "belalcazar": "Belalcázar", "belen de umbria": "Belén de Umbría",
    "bogota": "Bogotá D.C.", "bogota. d.c.": "Bogotá D.C.", "bogota d c": "Bogotá D.C.",
    "bojaya": "Bojayá", "calarca": "Calarcá", "carmen del darien": "Carmen del Darién",
    "certegui": "Certeguí", "chinchina": "Chinchiná",
    "el canton del san pablo": "El Cantón del San Pablo",
    "el litoral del san juan": "El Litoral del San Juan",
    "guatica": "Guática", "jamundi": "Jamundí", "jurado": "Juradó", "lloro": "Lloró",
    "medellin": "Medellín", "medio baudo": "Medio Baudó", "mistrato": "Mistrató",
    "novita": "Nóvita", "nuevo belen de bajira": "Nuevo Belén de Bajirá",
    "nuqui": "Nuquí", "pacora": "Pácora", "quibdo": "Quibdó", "quinchia": "Quinchía",
    "rio iro": "Río Iró", "rio quito": "Río Quito", "riofrio": "Riofrío",
    "samana": "Samaná", "san jose del palmar": "San José del Palmar",
    "santa rosa de cabal": "Santa Rosa de Cabal", "sipi": "Sipí", "tado": "Tadó",
    "tulua": "Tuluá", "unguia": "Unguía", "union panamericana": "Unión Panamericana",
    "villamaria": "Villamaría",
}

# Partículas que no van en mayúscula dentro de un topónimo.
PARTICULAS = {"De", "Del", "La", "Las", "Los", "El", "Y"}


def mostrar(nombre, clave):
    """Nombre presentable: primero el diccionario curado, si no, minúsculas
    en las partículas ("Belen De Umbria" -> "Belen de Umbria")."""
    if clave in DISPLAY:
        return DISPLAY[clave]
    partes = nombre.replace(".", "").split()
    return " ".join(p.lower() if i and p in PARTICULAS else p
                    for i, p in enumerate(partes))


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s).lower())
                   if unicodedata.category(c) != "Mn").strip()


def formas(nombre):
    """Formas bajo las que un titular puede nombrar al municipio.

    ⚠️ La fuente escribe la capital como "Bogota. D.C." —con punto también
    después del nombre— y la prensa escribe "Bogotá". Quitar solo el sufijo
    dejaba la llave en "bogota." y la capital del país, de donde sale buena
    parte de la cobertura, no se detectaba en ningún titular. Por eso se
    normaliza la puntuación antes de recortar, y no al revés.
    """
    base = sin_tildes(nombre)
    limpio = " ".join(base.replace(".", " ").split())      # "bogota. d.c." -> "bogota d c"
    salida = {base, limpio}
    for cand in (base, limpio):
        for suf in (" d.c.", " d. c.", " dc", " d c"):
            if cand.endswith(suf):
                salida.add(cand[: -len(suf)].strip(" ."))
    return [s for s in salida if s]


def main():
    if not os.path.exists(GEO):
        raise SystemExit("falta geo.json — corre antes build_geo.py")
    geo = json.load(open(GEO, encoding="utf-8"))["d"]

    entradas, excluidos = [], []
    vistos = set()
    for d in geo:
        for m in d["m"]:
            if not (d["n"] in DEPTOS or (d["c"], m[0]) in EXTRA):
                continue

            # ⚠️ La fuente trae el nombre alterno entre paréntesis Y A VECES
            # TRUNCADO: "Bahia Solano (Mutis)", "Union Panamericana (Las
            # Animas", "El Canton Del San Pablo (Man.". Tal cual no casan con
            # ningún titular. Se parte en sus dos formas y la del paréntesis
            # solo entra si quedó completa y es una palabra de verdad.
            crudo = m[1]
            principal = crudo.split("(")[0].strip()
            alternos = []
            if "(" in crudo:
                alt = crudo.split("(", 1)[1].rstrip(")").strip()
                if len(alt) >= 5 and "." not in alt:
                    alternos.append(alt)

            # ⚠️ El nombre visible se resuelve UNA vez, con la llave del nombre
            # principal. Resolverlo con la llave de cada variante hacía que el
            # alterno del paréntesis ("Pie De Pato") no encontrara la entrada
            # curada y saliera sin tilde, así que "Alto Baudó" y "Alto Baudo"
            # aparecían como dos municipios distintos en la misma lista.
            nombre_ui = mostrar(principal, sin_tildes(principal))
            claves = []
            for forma in [principal] + alternos:
                claves.extend(formas(forma))
            for clave in claves:
                if clave in AMBIGUOS:
                    excluidos.append(f"{clave} ({d['n']})")
                    continue
                # El Worker casa por LÍMITE DE PALABRA, así que "cali" no cae
                # dentro de "calidad" y un nombre de 4 letras es seguro. Solo
                # se descartan los de 3 o menos, donde ni el límite de palabra
                # salva del ruido. (Con el umbral en 4 se perdía Cali, que es
                # la ciudad más cubierta de todas.)
                if len(clave) <= 3:
                    excluidos.append(f"{clave} ({d['n']}) · muy corto")
                    continue
                if clave in vistos:
                    continue
                vistos.add(clave)
                entradas.append((clave, nombre_ui, d["n"],
                                 1 if d["n"] in DEPTOS else 0, m[2], m[3]))

    # Los nombres largos primero: así "San José del Palmar" se detecta antes de
    # que un nombre más corto contenido en él se lo lleve.
    entradas.sort(key=lambda e: (-len(e[0]), e[0]))

    filas = ",\n".join(
        f'  ["{c}", "{n}", "{dep}", {af},'
        f' {"null" if la is None else la}, {"null" if lo is None else lo}]'
        for c, n, dep, af, la, lo in entradas)
    js = f"""// GENERADO por tools/ayuda-sismo/build_municipios_js.py — no editar a mano.
//
// [clave, nombre, departamento, en_zona_afectada, lat, lon]. Ordenado de más
// largo a más corto para que "San Jose del Palmar" gane sobre un fragmento suyo.
//
// ⚠️ lat/lon es el CENTRO DEL MUNICIPIO, no el lugar del hecho. Sirve para
// poner una noticia en el mapa a escala municipal y nada más fino: todas las
// notas de un municipio caen exactamente en el mismo punto. La página lo dice
// en vez de simular una precisión que no existe.
//
// ⚠️ en_zona_afectada = 0 son ciudades que se vigilan solo para poder
// detectarlas en un titular (Bogotá, Medellín, Barranquilla…). NO deben entrar
// al conteo de "municipios sin cobertura": no estaban en la zona del sismo y
// listarlas ahí infla el hallazgo principal de la página.
//
// {len(excluidos)} municipios quedaron FUERA por nombre ambiguo o muy corto: su
// nombre casa con países, estados de EE. UU., departamentos o palabras
// comunes, y detectarlos por texto inflaría el conteo con notas ajenas.
// La página lo declara en la metodología.
export const MUNICIPIOS = [
{filas}
];

export const MUNICIPIOS_EXCLUIDOS = {json.dumps(sorted(excluidos), ensure_ascii=False)};
"""
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(js)

    print(f"  {len(entradas)} municipios detectables")
    print(f"  {len(excluidos)} excluidos por ambigüedad o longitud")
    for e in excluidos[:8]:
        print(f"     - {e}")
    print(f"\n→ {OUT}  ({os.path.getsize(OUT)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
