# Mapa de ayuda · sismo del 10 de agosto de 2026

Mapa abierto para registrar y encontrar necesidades tras el sismo M 7.4 con
epicentro en San José del Palmar (Chocó). Cubre Cali, Pereira, Manizales,
Armenia, Quibdó y cualquier punto del país por pin libre.

No es un canal oficial y la página lo dice arriba, sin letra chica: si hay
vidas en riesgo, el 123; personas desaparecidas, Cruz Roja y Medicina Legal.

```
ayuda-sismo/
  public/          la página (va a Cloudflare Pages)
    index.html     app completa: mapa, filtros, formulario, fotos, mensajes
    geo.json       33 deptos · 1.122 municipios con centro (44 KB)
    barrios.json   985 barrios de 4 ciudades (46 KB)
    _headers       cabeceras de Pages
  worker/          el backend (Cloudflare Workers + D1 + R2)
    src/index.js
    schema.sql
    wrangler.toml
tools/ayuda-sismo/
  build_geo.py       regenera geo.json     (divipola + PUESTOS_GEOREF)
  build_barrios.py   regenera barrios.json (GeoJSON de barrios)
  seed.py            publica puntos de prueba
```

## La puerta de entrada: qué quieres hacer y dónde

Quien llega no busca "un mapa": busca hacer **una** cosa. Antes, la página
abría con todo encima —mapa, dos filas de filtros, capas de acopios y prensa,
un formulario de 17 situaciones— y para dar el primer paso había que entender
la interfaz completa.

Ahora abre preguntando **qué** y **dónde**, en dos toques, y cada respuesta
lleva a la herramienta que ya existía:

| Intención | A dónde lleva |
|---|---|
| Necesito ayuda | Formulario abierto en el grupo *Necesito*, con el municipio ya puesto |
| Hay personas atrapadas | Formulario en *rescate*, la situación más urgente del catálogo |
| Quiero donar cosas | Mapa enfocado + capa de acopios + **la lista de acopios en el panel** |
| Quiero ser voluntario | Mapa filtrado a lo que alguien está pidiendo + botón para ofrecerse |
| Puedo ofrecer algo más | Formulario en el grupo *Puedo ayudar* |
| Busco a una persona | Formulario en `busco-persona`, con su aviso de privacidad |
| Mascota perdida o encontrada | Las dos situaciones de mascota juntas |
| Ver qué dice la prensa | Titulares del municipio en el panel |
| Explorar el mapa completo | La página tal como era |

La puerta **no es un catálogo de datos más**: `INTENCIONES` es el puente entre
"a qué vine" y lo que ya estaba construido. Ninguna intención agrega una
categoría nueva al modelo; todas reusan el catálogo de situaciones, el filtro
o la capa que corresponde.

- **Se muestra una vez por sesión** (`sessionStorage`), no en cada recarga:
  recargar sin querer en mitad de un formulario no debe devolver al menú. Se
  vuelve a abrir con el botón **Inicio** o con **Cambiar** de la barra azul.
- **No aparece** si se llegó por un enlace privado (`#/mi/…`) ni si la URL ya
  trae la intención.
- **Enlace directo**: `?ir=donar&dep=16&mun=001`. Sirve para que una
  organización comparta exactamente lo que ofrece sin pasar por el menú.
  Las claves son las de `INTENCIONES`; `dep` y `mun` son códigos de `geo.json`.
- **La barra de contexto** (azul, bajo las zonas) recuerda con qué intención se
  entró y ofrece la acción que sigue: quien viene a donar casi siempre termina
  queriendo publicar lo que tiene. En móvil, esa acción **reemplaza el texto
  del botón fijo**: ofrecerle "registrar una necesidad" a quien entró a donar
  es mandarlo al formulario contrario.

⚠️ La lista se filtra por **departamento** aunque se elija un municipio (el
mapa sí hace zoom al municipio). Un municipio con cero reportes se vería como
un mapa muerto, y la página tiene pocos reportes por definición al comienzo.

⚠️ Los acopios ahora se listan en el panel, no solo como puntos del mapa: para
saber si un punto recibe ropa o comida había que abrir su globo uno por uno, y
quien va a donar necesita **compararlos**. Se ordenan por cercanía al lugar
elegido, y si no hay ninguno en ese departamento se muestran los del país
entero con un aviso — mandar a alguien con un mercado a ninguna parte es peor
que ampliar el alcance.

⚠️ `hidden` **no oculta** un elemento con `display:flex` de una clase: la regla
de autor le gana a la del navegador. Por eso existe `.chips[hidden]`. Sin ella,
esconder los filtros no hacía absolutamente nada.

⚠️ **`nec-transporte` no existe** en el catálogo del Worker: transporte solo
está del lado de quien lo ofrece. "Busco transporte" entra como `nec-otro` con
su propio ejemplo. Si algún día se agrega la situación al Worker, basta cambiar
el `sit` de esa intención.

⚠️ Al quitar "Puedo ofrecer algo más" del menú, **ofrecer alojamiento,
transporte o atención médica ya no tiene tarjeta propia**. Sigue disponible
dentro del formulario (grupo *Puedo ayudar*) y como acción secundaria de donar
y voluntariado, pero quien tenga un cuarto libre ya no lo encuentra desde la
primera pantalla. Es una decisión de producto, no un olvido.

## La cara de la página

Diez mapas improvisados del terremoto se ven iguales: plantilla en blanco,
tipografía del sistema, ningún rastro de quién la mantiene. Eso no es solo
estética — cuando alguien tiene que decidir en cuál confía y cuál está
desactualizado, la identidad **es** la señal.

- **Fraunces** (Google Fonts) solo en los títulos. El cuerpo del texto sigue en
  la fuente del sistema: es lo que se lee con mala señal y no puede quedar en
  blanco esperando un archivo. Con `display=swap` el título se ve desde el
  primer pintado. **Cuesta ~19 KB** (el subconjunto `latin` de la variable, que
  cubre los dos pesos en un solo archivo). Es la única descarga añadida.
- **Trama de rombos en CSS puro** (`--trama`: dos rayados a 45° cruzados). Cero
  peticiones, cero KB. Da textura de papel impreso sin una imagen de fondo que
  habría que descargar en la calle.
- **Cada tarjeta tiene color propio** (`col` y `tint` de `INTENCIONES`): filo
  izquierdo y fondo de la cajita de imagen. Es lo que hace que la cuadrícula se
  lea de un vistazo aunque todavía no haya ni una foto.
- **Las imágenes son opcionales por diseño.** El `<img>` lleva
  `onerror="this.remove()"`, así que mientras el archivo no exista queda el
  emoji sobre el color. La página nunca se ve rota ni "en construcción"; se ve
  terminada, y cada foto que llega la mejora. Convención de nombres y tamaños
  en `public/imagenes/LEEME.txt`.

## El catálogo de situaciones (y por qué no es una matriz)

La primera versión combinaba **tipo** (necesito / ofrezco) × **categoría** (9).
Eso da 18 combinaciones y la mitad no significa nada: "Puedo ayudar + Mascotas"
no distingue entre buscar a mi perro y haber encontrado uno.

Ahora hay un **catálogo plano de 17 situaciones**, agrupadas en tres para poder
elegir en dos toques. Cada opción es una frase que se entiende sola y las
combinaciones absurdas no existen porque no están en la lista:

| Busco | Necesito | Puedo ayudar |
|---|---|---|
| Una persona desaparecida | Personas atrapadas o escombros | Encontré a una persona sin identificar |
| Mi mascota | Víveres, agua o ropa | Encontré una mascota |
| | Atención médica o medicamentos | Ofrezco alojamiento |
| | Dónde dormir | Ofrezco víveres o donaciones |
| | Edificación en riesgo de caerse | Ofrezco atención médica |
| | Sin agua, luz o señal | Ofrezco transporte o maquinaria |
| | Otra necesidad | Voluntario para remoción |
| | | Ofrezco otra ayuda |

El catálogo vive **dos veces a propósito**: en `SIT` del frontend (etiquetas,
ejemplos, colores) y en `SITUACIONES` del Worker (qué es privado, qué admite
foto). El Worker no confía en lo que mande el formulario; **valida contra su
propia copia**. `tipo` y `cat` se derivan del catálogo, no los manda el cliente.

Para agregar una situación hay que tocar las dos listas. Es el precio de no
tener paso de build, y es preferible a que el servidor acepte lo que sea.

## Las tres decisiones de diseño que no hay que deshacer

**1. El contacto de una persona desaparecida no se publica nunca.** Se muestra
el caso completo (nombre, señas, zona) pero quien tenga información escribe por
el mapa y el mensaje le llega al familiar. Publicar el teléfono de una familia
que busca a alguien es exactamente lo que habilita la llamada extorsiva, que es
un patrón documentado después de un desastre. El Worker lo fuerza del lado
servidor: aunque el cliente mande `contacto_pub:true`, en esa categoría se
guarda en 0.

**2. El texto libre se enmascara.** De nada sirve no publicar el campo de
contacto si la persona escribe su celular dentro de la descripción. Todo
reporte sin contacto público pasa por `enmascarar()`, que tapa correos y
cualquier corrida de 7+ dígitos. Verificado: `"llamar al 320 555 8899"` sale
publicado como `"llamar al [teléfono oculto]"`.

**3. La ubicación pública va desplazada ~100 m.** Quien reporta marca y ve su
punto exacto; el mapa público muestra otro punto dentro de un disco de 100 m.
Un pin exacto junto a "familia sin comida" y un teléfono es un directorio de
casas vulnerables. El desplazamiento se calcula **una sola vez, al insertar**, y
se guarda: si se recalculara en cada lectura, dos capturas del snapshot
permitirían promediar y recuperar la posición real. La coordenada exacta queda
en la base y solo la ven moderación y el propio reportante.

Medido en pruebas: desplazamientos de 93,1 m y 69,0 m sobre puntos conocidos.

**3b. La dirección es opcional y se avisa que se publica tal cual.** El campo
"dirección o señas" viaja como primera línea de `detalle` (es la columna que el
servidor ya guarda y publica, así que no depende de un cambio de esquema; el
`maxlength` del textarea bajó a 1000 para que la dirección no se coma el final
del texto en el tope de 1200 del servidor). Escribir la dirección exacta de una
casa **anula** el desplazamiento de 100 m de la regla 3, así que el campo lo
dice en voz alta y sugiere una seña ("frente a la cancha") cuando es la propia
vivienda. Para quien ofrece —un acopio, una bodega— la dirección exacta es
justo lo que hace útil el reporte.

**4. La foto se reduce y se re-codifica en el dispositivo, antes de subirla.**
No es por peso — o no solo. Una foto de celular trae **EXIF con las coordenadas
GPS exactas** de dónde se tomó; publicarla tal cual echaría por tierra el
desplazamiento de 100 m de la regla 3. Redibujarla en un canvas y volver a
codificarla descarta todos los metadatos, así que el mismo paso que la
aligera es el que la limpia. Verificado: una imagen de 2400×1600 sale a
1280 px, 16 KB, sin bloque `Exif`.

El servidor no confía en eso: valida los **bytes mágicos** del archivo, no el
`Content-Type` que declara el cliente. Verificado con un script de shell
etiquetado como `image/jpeg` — se descarta la imagen y el reporte se publica
igual, en vez de fallar entero.

Las fotos viajan **dentro del POST del reporte**, en base64, no por un endpoint
propio. Un endpoint de subida suelto sería almacenamiento abierto a internet;
así la imagen hereda el límite por IP, el captcha y la validación del reporte.

⚠️ **"Encontré a una persona" no admite foto**, a diferencia de las mascotas:
quien está desorientada o herida no puede dar su consentimiento, y para
reencontrarla bastan la descripción y el lugar. Está en el catálogo del Worker,
así que aunque el formulario mandara una, se descarta.

⚠️ Ocultar un reporte por moderación **borra también su imagen de R2**. Si no,
"ocultar" solo la quitaría del mapa y la URL seguiría sirviendo el archivo a
quien ya la conociera.

## Desplegar

Todo desde `ayuda-sismo/worker` salvo el paso de Pages.

```bash
npx wrangler login
```

**1. Base de datos**

```bash
npx wrangler d1 create ayuda-sismo
```

Pega el `database_id` que imprime en `wrangler.toml`, y luego:

```bash
npx wrangler d1 execute ayuda-sismo --remote --file=schema.sql
```

**1b. Bucket de fotos**

```bash
npx wrangler r2 bucket create ayuda-sismo-fotos
```

Si el binding no existe la app funciona igual: simplemente no guarda fotos.

**2. Secretos**

```bash
# Obligatorios
openssl rand -base64 32 | npx wrangler secret put ADMIN_TOKEN
openssl rand -base64 32 | npx wrangler secret put IP_SALT

# Recomendados
npx wrangler secret put TURNSTILE_SECRET   # anti-bot
npx wrangler secret put RESEND_API_KEY     # aviso por correo al reportante
```

Sin `TURNSTILE_SECRET` el formulario **sigue recibiendo** —tumbar la recepción
de reportes en plena emergencia es peor que recibir spam— pero cada reporte
queda marcado `sin_captcha=1` para que moderación lo mire primero.

**3. Worker**

```bash
npx wrangler deploy
```

Anota la URL que imprime (`https://ayuda-sismo.<sub>.workers.dev`) y ponla en
dos sitios: `CONFIG.API` de `public/index.html` y `API_BASE` de
`wrangler.toml`. Vuelve a correr `npx wrangler deploy`.

**4. Página**

```bash
cd ../..
npx wrangler pages project create ayuda-sismo --production-branch=main
npx wrangler pages deploy ayuda-sismo/public --project-name=ayuda-sismo
```

**5. Dominio propio**

En el panel de Cloudflare → Workers & Pages → ayuda-sismo → Custom domains →
agregar `sismo.ricardoruiz.co`. Cloudflare pide un CNAME; como el DNS de
ricardoruiz.co está en **GoDaddy**, se crea allá:

```
Tipo: CNAME    Nombre: sismo    Valor: ayuda-sismo.pages.dev
```

**6. Turnstile**

dash.cloudflare.com → Turnstile → añadir widget para `sismo.ricardoruiz.co`.
La *site key* va en `CONFIG.TURNSTILE` de `index.html`; la *secret key* es el
`TURNSTILE_SECRET` del paso 2.

## ⚠️ Por qué la página NO va en ricardoruiz.co directo

`ricardoruiz.co` está servido por **GitHub Pages**, que tiene un límite blando
de ~100 GB/mes de ancho de banda. Con el millón de visitantes que esperamos,
GitHub puede throttlear o suspender el sitio — y se caería **todo**
ricardoruiz.co, no solo este mapa. Cloudflare Pages no cobra ni limita el ancho
de banda. Por eso subdominio apuntando a Pages, y no un archivo más en el repo.

## Costo real con un millón de visitantes

La arquitectura separa lectura de escritura, que es lo que mantiene la factura
en cero:

- **Lecturas** (el 99,9% del tráfico): `/snapshot.json` se sirve desde el caché
  del edge con `s-maxage=60`. Un millón de visitas no se traduce en un millón
  de consultas a D1, sino en una consulta por minuto y por centro de datos.
- **Escrituras** (los reportes, quizá miles): Worker → D1. El plan gratis
  aguanta 100.000 escrituras al día.

| Servicio | Plan gratis | Con 1M de visitantes |
|---|---|---|
| Pages | ancho de banda y peticiones ilimitados | $0 |
| Workers | 100.000 req/día | ~2M invocaciones/mes |
| D1 | 5 GB · 100k escrituras/día | holgado |
| Turnstile | gratis | $0 |

**Recomendación: pagar los $5/mes de Workers Paid igual.** No porque haga
falta, sino porque quita el techo de 100.000 req/día — si algo se cachea mal,
ese techo tumba el sitio en plena emergencia. Incluye 10M de invocaciones y
cobra $0.30 por millón adicional. **Peor escenario realista: $5 a $8/mes.**

**Project Galileo.** Cloudflare da protección nivel enterprise gratis a
proyectos humanitarios: <https://www.cloudflare.com/galileo/>. Vale la pena
aplicar el mismo día que salga al aire.

## Moderar

```bash
API=https://ayuda-sismo.<sub>.workers.dev
TOKEN=<el ADMIN_TOKEN>

# Cola de revisión: lo marcado por usuarios o recibido sin captcha
curl -s "$API/admin/reportes?alerta=1" -H "X-Admin-Token: $TOKEN" | python3 -m json.tool

# Ocultar algo falso
curl -s -X POST "$API/admin/estado" -H "X-Admin-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"id":"abc12345","estado":"oculto"}'

# Marcar como verificado por una organización
curl -s -X POST "$API/admin/estado" -H "X-Admin-Token: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"id":"abc12345","verificado":true}'
```

La vista de admin sí devuelve la **coordenada exacta y el contacto**: es lo que
necesita una organización para llegar al sitio.

⚠️ **Marcar abuso no oculta nada solo.** Cuenta y manda a la cola de revisión,
con una marca por IP y por reporte (lo impone la llave primaria de
`abuso_log`). Si unos clics bastaran para tumbar un reporte, una campaña
coordinada podría borrar del mapa justo los casos reales.

## Inteligencia · pulso de prensa (entrega 1 de 2)

`public/inteligencia.html` + `worker/src/inteligencia.js`. Cuenta titulares
publicados sobre el sismo para ver a qué municipios llega la atención.

**⚠️⚠️ MIDE COBERTURA MEDIÁTICA, NO REALIDAD.** La unidad es el titular. 40
titulares que piden ayuda en un municipio no son 40 ayudas pedidas: son 40
titulares. Un municipio sin periodistas se ve idéntico a uno sin problemas. Por
eso el **hallazgo principal es el silencio**: cuántos municipios de la zona
afectada no aparecen en una sola noticia. Medido: **88 de 101**.

- **Fuente**: Google News RSS (`hl=es-419&gl=CO`), 17 consultas por tema y
  ciudad. Gratis, sin API key. ⚠️ Devuelve **302**: hay que seguir la redirección
  (`curl -L`; `fetch` con `redirect:'follow'`). Sin eso llegan cero resultados.
- **Clasificación determinista**, sin modelo de lenguaje: diccionarios de
  palabras y reglas. El único texto de IA es el párrafo azul del comienzo, va
  marcado y no produce ninguna cifra. Necesita `DEEPSEEK_API_KEY`; sin ella la
  página sale igual, sin párrafo.
- **Cron cada 3 horas** (`[triggers]` en wrangler.toml). La recolección no
  ocurre por visita: el visitante no paga la latencia ni el gasto crece con el
  tráfico. Disparo manual: `POST /admin/inteligencia` con `X-Admin-Token`.

**Las tres cifras de honestidad que la página publica en vez de esconder:**

| | Medido | Por qué está a la vista |
|---|---|---|
| Sin intención clasificable | **79%** | Con solo el titular no se sabe si algo se pide, se promete o se entrega. Publicar los conteos sin este denominador haría creer que describen todo el corpus. |
| Sin municipio detectable | **46%** | Hablan del país en general. |
| Municipios no detectables por nombre | **24** | Ver abajo. |

⚠️ **Nombres que no se pueden contar por texto** (`AMBIGUOS` en
`build_municipios_js.py`): "Sevilla" trae noticias de España, "Florida" de
Estados Unidos, "Bolívar" y "Córdoba" son departamentos, "El Cairo" es Egipto.
Se excluyen y se declaran. Es preferible no contar un municipio a atribuirle
notas ajenas.

⚠️ **Bogotá, Medellín, Barranquilla, Cartagena, Bucaramanga, Neiva y Pasto**
llevan `en_zona_afectada = 0`: se vigilan para poder detectarlas en un titular,
pero **no entran al conteo de municipios sin cobertura**. Contarlas ahí infla el
hallazgo principal con ciudades que nunca fueron el punto (pasaba: Bucaramanga
aparecía listada como municipio sin cobertura).

Regenerar la lista tras cambiar `geo.json` o los diccionarios:

```bash
python3 tools/ayuda-sismo/build_municipios_js.py
```

**Entrega 2, pendiente: zonas de silencio.** El cruce de esta cobertura contra
los reportes ciudadanos del mapa — municipios con necesidad reportada y sin una
sola nota. Es lo que un monitor de prensa no puede responder, y necesita volumen
de reportes para tener fuerza. Hoy solo hay datos de prueba.

## Puntos de prueba

```bash
python3 tools/ayuda-sismo/seed.py                    # contra localhost:8787
python3 tools/ayuda-sismo/seed.py --api https://...  # contra el desplegado
```

18 reportes de ejemplo con las 3 familias de situación, repartidos entre
capitales y municipios vecinos (Dosquebradas, Villamaría, Yumbo, Calarcá).
Van con el prefijo `[PRUEBA]` en el título para poder borrarlos:

```bash
npx wrangler d1 execute ayuda-sismo --remote \
  --command "DELETE FROM reportes WHERE titulo LIKE '[PRUEBA]%'"
```

⚠️ El Worker limita a 5 reportes por hora y por IP, así que el script manda una
`CF-Connecting-IP` distinta por caso. **Eso solo funciona contra `wrangler
dev`**: en producción Cloudflare fija esa cabecera en el edge y descarta la que
mande el cliente. No es un agujero, es la razón por la que se puede sembrar en
local sin bajar el límite real.

## Regenerar la geografía

```bash
python3 tools/ayuda-sismo/build_geo.py       # geo.json  (deptos + municipios)
python3 tools/ayuda-sismo/build_barrios.py   # barrios.json
```

`geo.json` sale de `divipola.json` (nombres y códigos oficiales) cruzado con
`PUESTOS_GEOREF.csv` (13.508 puntos) para sacar el **centro de cada municipio**
por mediana — el promedio se corre kilómetros con un solo puesto rural mal
georreferenciado. Cobertura: 33 departamentos, 1.122 municipios, 69 sin
coordenada (se pueden elegir igual, marcando el punto a mano).

⚠️ Los códigos de esta fuente son de la **Registraduría, no del DANE**:
Caldas=09, Chocó=17, Quindío=26, Risaralda=24, Valle=31. Por eso `AFECTADOS`
en el script marca por nombre y **revienta el build** si un nombre deja de
casar, en vez de dejar la página sin sus accesos rápidos en silencio.

⚠️ Los nombres de municipio vienen **sin tildes** ("Quibdo", "Villamaria"). Los
33 departamentos se corrigen a mano en `DEP_NOMBRES`; los 1.122 municipios no,
porque corregirlos a mano sería introducir erratas. La búsqueda del sitio
ignora tildes, así que quien escriba "Quibdó" igual encuentra "Quibdo".

`barrios.json` cubre Cali 339 · Pereira 472 · Manizales 114 · Quibdó 60.
⚠️ **Armenia no tiene capa de barrios en el repo**: el selector simplemente no
aparece para ese municipio y se marca el punto en el mapa. Si aparece un
GeoJSON de Armenia, es una línea en el dict `CIUDADES` del script y otra en
`BARRIOS_DE` del HTML.

## Probar en local

```bash
cd ayuda-sismo/worker
npx wrangler d1 execute ayuda-sismo --local --file=schema.sql
npx wrangler dev --port 8787 --local
```

En otra terminal, desde la raíz del repo, `python3 -m http.server 8765` y abrir
`http://localhost:8765/ayuda-sismo/public/index.html`. La página detecta que
está en localhost y apunta sola al Worker local, para no escribir en la base de
producción.
