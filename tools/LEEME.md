# Scripts de datos

Python estándar, sin dependencias, salvo donde se indique.

## Autocontenidos (corren tal cual)

| Script | Qué hace |
|---|---|
| `reparar_coordenadas.py` | Recupera las coordenadas que Google Sheets rompe al pegarlas |
| `geocodificar_acopios.py` | Llena LATITUD/LONGITUD con el registro de placas de Catastro Bogotá |
| `importar_hoja_bogota.py` | Trae la hoja pública de voluntariado y donaciones de Bogotá |
| `seed.py` | Publica reportes de prueba contra un Worker local |
| `copernicus.py` | Resume el daño evaluado por Copernicus EMS antes de desplegarlo |

## Necesitan las bases de datos grandes

Estos leen georreferenciación y mapas municipales que no viven acá porque pesan
cientos de MB. Se apunta con la variable `DATOS`:

```bash
DATOS=~/ricardoruiz.co python3 tools/importar_smartcity.py
```

| Script | Qué necesita |
|---|---|
| `importar_smartcity.py` | Mapas municipales por departamento (para punto-en-polígono) |
| `build_geo.py` | `divipola.json` + `PUESTOS_GEOREF.csv` |
| `build_barrios.py` | GeoJSON de barrios por ciudad |
| `build_municipios_js.py` | `geo.json` ya generado |

Si falta el dato, el script **para y dice dónde buscarlo**. No degrada en
silencio: un CSV vacío que parece correcto es peor que un error.
