# Voluntarios · cruce con la lista de Google Maps (15-ago-2026)

Fuente: lista compartida **"Voluntariado Bogotá - Agosto 2026"** de
`stromanthetriostar` (115 lugares), leída el 15-ago-2026.
`https://www.google.com/maps/placelists/list/XJQY-o3hsph0A1kkDaEESw`

De los 115 lugares, **9 piden voluntarios** (🟢). El resto: 93 marcados 🔴 "no
voluntarios" —casi todos reciben solo donaciones, muchos son tiendas de
mascotas— y 10 en 🟡 "información por actualizar".

## Poner REQUIERE VOLUNTARIOS = SI (ya están en la hoja, hoy dicen NO)

Buscar por el nombre EXACTO de la columna NOMBRE:

| En nuestra hoja | Ciudad | Lo que dice la lista |
|---|---|---|
| `CRIC` | Bogotá | SOS Juntos por el Chocó, desde la 1 p.m. |
| `VIVE CLARO` | Bogotá | sábado desde mediodía, **con registro previo** |
| `FUNDACIÓN TRANSFORMANDO VIDAS CRA 104` | Bogotá | JAC Pastranita, Cra. 80a # 49-8 |
| `Cruz Roja - Palacio de los Deportes` | Bogotá | voluntarios **ya mismo** + donación de sangre |
| `FUNZA Interpark -` | Funza | voluntarios **ya** |
| `Estadio el Campín` | Bogotá | Sencia, **sin inscripción**, 3 jornadas (noche, madrugada, sábado mañana) |
| `MATCHACHÁ Y AMARÍA HAIRSPA` | Bogotá | cadena humana, 70-80 personas, desde las 8 a.m. |

## Agregar (no están en la hoja)

Las dos filas de `voluntarios-15ago-2026.csv`: **Parque Santander** (sábado
12:00 p.m., con inscripción) y **Taller Distinto** (Tv. 1 #83-51, sábado
9:30 a.m.).

## ⚠️⚠️ Esto caduca hoy

La lista dice literalmente *"No se actualiza más por hoy 14/08 08:00 p.m."* y
casi todos los avisos hablan de **SÁBADO**, que es el 15 de agosto. **Nuestra
hoja no tiene fecha de caducidad para la columna de voluntarios**: lo que se
marque hoy va a seguir diciendo "necesita voluntarios" el lunes, y mandar gente
un lunes a un punto que solo pedía manos el sábado es exactamente el tipo de
error que la columna ULTIMA REVISION existe para evitar.

Dos salidas, ninguna hecha todavía:

1. Llenar **ULTIMA REVISION** con `2026-08-15` en estas filas y revisarlas el
   lunes. Es lo que la hoja ya soporta.
2. Que la columna de voluntarios tenga su propia vigencia (por ejemplo
   `VOLUNTARIOS HASTA`), y que el mapa deje de mostrarla sola al vencerse. Eso
   sí exige tocar el parser en `worker/src/acopios.js`.

## ⚠️ Un falso positivo del cruce automático, para que no se repita

Emparejar por palabras sueltas hizo casar **"Parque Santander" (Bogotá)** con
**"Café Kennedy · Parque principal de Kennedy" (Pereira)**: coincidía la
palabra "parque" y nada más. Los pares de arriba están verificados uno por uno
contra el nombre completo. Si se automatiza este cruce, hay que exigir además
que coincida la ciudad.
