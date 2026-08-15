# Mapa de ayuda · sismo del 10 de agosto de 2026

Mapa abierto para registrar y encontrar necesidades tras el sismo M 7.4 con
epicentro en San José del Palmar (Chocó) y los incendios forestales de Nariño.
Cubre Cali, Pereira, Manizales, Armenia, Quibdó y cualquier punto del país.

**En producción:** <https://ayuda-sismo.pages.dev>

No es un canal oficial y la página lo dice arriba, sin letra chica: si hay
vidas en riesgo, el 123; personas desaparecidas, Cruz Roja y Medicina Legal.

## Cómo contribuir

El proyecto se hizo en emergencia y se va a entregar a organizaciones que lo
mantengan. Los aportes son bienvenidos; tres cosas antes de empezar:

1. **Lee las decisiones que no hay que deshacer** (más abajo). Varias parecen
   detalles y son de privacidad: la ubicación desplazada 100 m, el contacto que
   nunca se publica en casos de personas desaparecidas, la foto que se
   re-codifica para borrarle el GPS. Si algo de eso estorba, hay una razón
   escrita al lado.
2. **Un PR mergeado no sale al aire.** La página está en Cloudflare Pages y se
   despliega a mano (ver *Desplegar*).
3. **`public/index.html` es un solo archivo con el JS adentro**, sin paso de
   build. Antes de cada push hay que validar que el JS parsea, porque un error
   de sintaxis deja la página en blanco:

```bash
python3 - <<'EOF'
import re
h = open('public/index.html', encoding='utf-8').read()
b = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', h, re.S)
open('/tmp/js.js', 'w', encoding='utf-8').write('\n'.join(b))
EOF
node -e "new Function(require('fs').readFileSync('/tmp/js.js','utf8')); console.log('JS OK')"
```

Para verlo en local basta un servidor estático; la página detecta `localhost` y
apunta sola al Worker local para no escribir en la base de producción:

```bash
python3 -m http.server 8765     # y abrir http://localhost:8765/public/
```

```
public/          la página (se despliega a Cloudflare Pages)
  index.html     app completa: puerta de entrada, mapa, formularios
  inteligencia.html  informe de cobertura de prensa
  geo.json       33 deptos · 1.122 municipios con centro (44 KB)
  barrios.json   985 barrios de 4 ciudades (46 KB)
  imagenes/      ilustraciones de las tarjetas (JPG de 240 px)
worker/          el backend (Cloudflare Workers + D1 + R2)
  src/index.js       reportes, mensajes, moderación
  src/acopios.js     centros de acopio desde una hoja de Google
  src/inteligencia.js  recolección de titulares
tools/           scripts de datos (ver tools/LEEME.md)
datos/           CSV de acopios listos para pegar en la hoja
imagenes-fuente/ los PNG originales de las ilustraciones
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
| Quiero donar cosas | Mapa enfocado + capa de acopios + la lista de acopios en el panel |
| Quiero ser voluntario | Pregunta cuándo puede ir y entrega una LISTA de sitios por cercanía |
| Necesito ayuda | Qué falta, para cuántos y si alguien no puede esperar; enruta a víveres, salud u otra |
| Hay personas atrapadas | Formulario en `nec-rescate` |
| Busco alojamiento | Pregunta quién es y entra a `nec-refugio` con su ejemplo |
| Busco atención médica | Para quién, qué necesita y si puede llegar a un puesto de salud |
| Busco transporte | `nec-otro` con ejemplo propio (ver aviso abajo) |
| Necesito reconstruir | Pregunta qué hace falta y entra a `nec-estructural` |
| Busco a una persona | `busco-persona`, con su aviso de privacidad |
| Busco a mi mascota | Especie, tamaño, color y cuándo se perdió, a toques |
| Encontré una mascota | Especie, tamaño, color y si trae collar, a toques |
| Necesito voluntarios | `nec-otro` con ejemplo propio (ver aviso abajo) |
| Quiero ayudar psicológicamente | `ofr-salud` con ejemplo de acompañamiento |
| Puedo poner transporte | `ofr-transporte` |
| Registrar un centro de acopio | Formulario propio de seis campos |
| Qué dicen las noticias | Titulares del territorio en el panel |
| Ver informes | El informe completo de cobertura de prensa |
| Ver el mapa completo | La página tal como era, para filtrar a mano |

**El menú tiene dos niveles.** La primera pantalla pregunta una sola cosa —
**Quiero ayudar** · **Necesito ayuda** · **Ver el mapa e informes** — y las
opciones concretas aparecen dentro de la que se elija (`FAMILIAS` en
`index.html`). Antes salían las catorce juntas, que son catorce decisiones a la
vez para alguien que abre esto en la calle. Agregar una opción es meter su
clave en el `ops` de una familia; `verificarFamilias()` avisa por consola si
alguna quedó fuera y por tanto inalcanzable.

⚠️ **"Hay personas atrapadas" NO se esconde detrás de un toque**: va suelta
encima de las tres puertas. Es la única opción de la página donde el tiempo se
mide en minutos, y hacer navegar un menú para reportar a alguien bajo escombros
no lo compensa ninguna limpieza de pantalla.

**Las preguntas reemplazan al formulario, no lo adornan.** Las señas de una
mascota —especie, tamaño, color, collar— se preguntan a toques y no como texto
libre: "perdí a mi perrita" no sirve para reconocer a nadie, mientras que tres
listas cerradas se contestan sin escribir y son justo lo que permite cruzar una
mascota perdida con una encontrada. Cada respuesta entra al detalle como una
frase editable.

**La situación queda cerrada cuando la puerta ya la determinó.** El formulario
mostraba de nuevo los tres grupos y las diecisiete situaciones, así que quien
entraba por "encontré una mascota" podía salir con un reporte de otra cosa.
Ahora sale un rótulo con lo elegido y un "Cambiar" para quien de verdad se
equivocó. Si se entró por un GRUPO (como "Necesito ayuda", que no fija la
situación) el selector se queda: ahí todavía hay que elegir.

**Una respuesta puede mover la urgencia.** En víveres, decir que hay un bebé,
un adulto mayor o alguien enfermo sube el reporte a urgencia alta; en salud lo
hace responder que la persona no puede moverse. Dejarlo en media sería
desperdiciar la respuesta. Va **propuesta, no impuesta** — el selector sigue
ahí y se puede bajar.

**Y una respuesta puede quitar un campo.** Cuando el flujo ya preguntó para
cuántas personas (`pers` en la opción), el formulario esconde su campo
numérico: volver a pedirlo es preguntar dos veces lo mismo, que es justo lo que
estas preguntas vinieron a quitar. Se pierde el número exacto y queda el rango
dentro del detalle — es el precio de no repetir la pregunta.

⚠️⚠️ **El detalle auto-generado se reemplaza; lo que escribe la persona, nunca.**
La condición no puede ser "el campo está vacío": con eso, quien abría un flujo,
se devolvía y entraba por otro se llevaba el detalle del primero — se vio un
reporte de "busco a mi mascota" que decía "tiene collar con placa", una frase
del flujo contrario, en el campo que la gente lee para reconocer al animal. Se
distingue con `detAuto`, y la urgencia arrastraba igual (`urgAuto`): un reporte
donde nadie estaba en condición especial salía en alta heredada del anterior.

⚠️ **El formulario NO se limpia entre flujos.** `detAuto` y `urgAuto` tapan los
dos campos que la puerta llena, pero si más adelante se auto-completan otros
(dirección, número de personas) van a arrastrar igual. La solución de fondo es
limpiar el formulario al empezar un flujo nuevo, respetando lo que la persona
haya escrito.

**Las preguntas se encadenan.** Cada intención declara en `subs` cuántas
preguntas necesita antes de actuar, y `pasosDe()` las recorre de a una. Lo
respondido entra al formulario como primeras líneas del detalle, editables: es
contexto que quien va a ayudar necesita leer y que la persona no tiene por qué
volver a escribir.

La puerta **no es un catálogo de datos más**: `INTENCIONES` es el puente entre
"a qué vine" y lo que ya estaba construido. Ninguna intención agrega una
categoría nueva al modelo; todas reusan el catálogo de situaciones, el filtro
o la capa que corresponde.

- **Se muestra SIEMPRE**, también al recargar y al volver otro día. Se probó
  recordándola por sesión y la experiencia es peor: quien entra —o refresca— se
  encuentra un mapa lleno de puntos sin saber qué hacer con él. El mapa solo no
  dice nada; la pregunta sí. Hay un botón **← Atrás** que retrocede un paso, no
  reinicia, para poder explorar sin quedar encerrado en una rama.
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

⚠️ **Ofrecer alojamiento, transporte o atención médica no tiene tarjeta
propia.** Sigue disponible dentro del formulario (grupo *Puedo ayudar*) y como
acción secundaria de donar y voluntariado, pero quien tenga un cuarto libre no
lo encuentra desde la primera pantalla. Es una decisión de producto, no un
olvido.

⚠️ **"Necesito reconstruir" entra por `nec-estructural`** (edificación dañada)
porque el catálogo del Worker no tiene una situación de reconstrucción. No es
solo un parche: es de las pocas que admiten FOTO, y para conseguir tejas y
manos la foto del daño hace más que cualquier descripción.

## La cara de la página

Diez mapas improvisados del terremoto se ven iguales: plantilla en blanco,
tipografía del sistema, ningún rastro de quién la mantiene. Eso no es solo
estética — cuando alguien tiene que decidir en cuál confía y cuál está
desactualizado, la identidad **es** la señal.

- **Arial del sistema en los títulos**, en peso alto y tracking apretado. Se
  probó con Fraunces de Google Fonts (~19 KB) y se devolvió: la página se abre
  en la calle con mala señal, y no pedir ni un archivo de fuente es una ventaja
  real. La cara propia la ponen la trama, los colores por tarjeta y las
  ilustraciones — no una tipografía descargada.
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

## Los puntos de acopio en el mapa

**El marcador es una caja con el símbolo del tipo de lugar.** Un punto redondo
verde no distingue una universidad de una bodega ni de un puesto de la Cruz
Roja, y esa diferencia decide a dónde va alguien con un mercado en el carro.
La tabla `TIPO_GLIFO` en `index.html` traduce la columna TIPO DE LUGAR de la
hoja a un símbolo; un tipo que no esté cae a la caja genérica, y agregarlo es
una línea. Cuando la columna viene vacía se mira el NOMBRE, que es donde
aparecen "Cruz Roja" y "Bomberos" la mayoría de las veces.

⚠️ **El color no cambia por tipo, a propósito.** Si cada tipo tuviera su color,
la capa dejaría de leerse como "acopios" y competiría con los colores de los
reportes, que son el dato propio de la página. El símbolo lleva el tipo; el
verde lleva la categoría.

### Coordenadas: `tools/geocodificar_acopios.py`

Llena LATITUD y LONGITUD de la hoja, que son las columnas que mandan sobre el
centro del municipio.

⚠️⚠️ **NO se le pregunta a un modelo de lenguaje por las coordenadas.** Un
modelo responde un par de números con total seguridad y sin manera de saber si
son los correctos, y un pin que PARECE exacto y está a cinco cuadras es peor
que el centro del municipio: el centro se declara aproximado, el pin falso no.

- **Bogotá** sale de la **Placa Domiciliaria de Catastro Distrital** (ArcGIS
  público, `catastro/placadomiciliaria`). Es el registro de las placas reales:
  si la dirección existe, el punto es el de la puerta. **58 de 74.**
- **El resto** por NOMBRE en Nominatim, con las tres validaciones que ya usa el
  Worker (≤30 km del centro, que no sea una vía, y una palabra distintiva del
  nombre en la respuesta). Rinde poco y es esperable.
- Total: **64 de 106**. Lo que no valida se deja **en blanco**, no se inventa.

Gotchas del registro de placas, todos medidos:

| | |
|---|---|
| `PDOTEXTO` trae **espacio al final** (`"78A 05 "`) | comparar con `LIKE`, no con `=`; con `=` no casa ni una |
| El sur se escribe **" S"**, no "SUR" | `CL 65 S` |
| La vía va aparte del número | `PDONVIAL='KR 15A'` + `PDOTEXTO LIKE '122 27%'` |
| Sin placa exacta | se acepta la más cercana de la misma vía **solo dentro de ±20**, que en Bogotá es menos de media cuadra |

## Desplegar

Todo desde `worker` salvo el paso de Pages.

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
npx wrangler pages deploy public --project-name=ayuda-sismo
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
python3 tools/build_municipios_js.py
```

**Entrega 2, pendiente: zonas de silencio.** El cruce de esta cobertura contra
los reportes ciudadanos del mapa — municipios con necesidad reportada y sin una
sola nota. Es lo que un monitor de prensa no puede responder, y necesita volumen
de reportes para tener fuerza. Hoy solo hay datos de prueba.

## Daño visto desde satélite · Copernicus EMS

`worker/src/copernicus.js` + capa "Daño satelital" en el mapa. Es la contraparte
de todo lo demás que hay en la página: los reportes son **necesidad declarada**
por la gente, esto es **daño observado** por el servicio de emergencias de la
Unión Europea sobre imagen de satélite.

**⚠️⚠️ NO CUBRE EL PAÍS, y esa advertencia va en la leyenda del mapa, no en una
nota al pie.** Se analizaron seis manchas urbanas; **el epicentro (San José del
Palmar) no tiene ninguna**. Por eso se dibuja el **contorno punteado de cada
zona analizada**: así se ve dónde alcanza lo que sabemos y dónde nadie ha
mirado. Un municipio sin puntos no es un municipio sin daño.

Al 14 de agosto: **622 edificios evaluados** (239 destruidos · 275 dañados · 108
posiblemente dañados), **13 vías bloqueadas** y 26 tramos de vía dañados, en
Buenaventura, Pereira, Quibdó, Cali (dos zonas) e Istmina.

- **Fuente**: API pública sin clave.
  `rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=EMSR916`.
  Los vectores salen del bucket del visor cambiando el sufijo `_VT` por `.json`.
- **Licencia**: reutilización libre citando
  `© Unión Europea, Copernicus Emergency Management Service (EMSR916)`. El
  crédito va en la leyenda, con enlace a la activación.
- **Cron diario** a las 06:40 de Colombia, no cada 3 horas como la prensa:
  Copernicus entrega uno o dos productos por día y consultarlo más seguido
  traería catorce veces lo mismo. Disparo manual: `POST /admin/copernicus` con
  `X-Admin-Token`.

**Tres reglas del dato que no hay que deshacer:**

1. **Una zona puede tener varias entregas** (producto inicial + monitoreos). Son
   la MISMA zona re-evaluada, no zonas distintas: sumarlas contaría los mismos
   edificios dos veces. Pasa hoy con Buenaventura (256 en el producto inicial,
   335 en el monitoreo) y se conserva solo la última.
2. **"Posiblemente dañado" es fotointerpretación**, no daño confirmado. Va en su
   propio grado y nunca se suma con "destruido" en una sola cifra.
3. **De las vías solo entran los tramos con daño.** Las intactas son más de
   11.000 rasgos que multiplicarían el peso del archivo sin aportar una sola
   decisión; los bloqueos, en cambio, son lo más accionable del paquete: le
   dicen a quien va a llevar ayuda por dónde no puede pasar.

Ver los datos antes de desplegar, sin tocar producción:

```bash
python3 tools/copernicus.py                       # resumen por zona
python3 tools/copernicus.py --json public/cop.json  # el mismo archivo que sirve el Worker
```

Cuando se cierre la activación, o para otro evento, se cambia `ACTIVACION` en
`worker/src/copernicus.js` (y `--codigo` en el script). Todo lo demás —zonas,
productos, capas— lo descubre solo desde la API.

## Puntos de prueba

```bash
python3 tools/seed.py                    # contra localhost:8787
python3 tools/seed.py --api https://...  # contra el desplegado
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
python3 tools/build_geo.py       # geo.json  (deptos + municipios)
python3 tools/build_barrios.py   # barrios.json
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
cd worker
npx wrangler d1 execute ayuda-sismo --local --file=schema.sql
npx wrangler dev --port 8787 --local
```

En otra terminal, desde la raíz del repo, `python3 -m http.server 8765` y abrir
`http://localhost:8765/public/index.html`. La página detecta que
está en localhost y apunta sola al Worker local, para no escribir en la base de
producción.
