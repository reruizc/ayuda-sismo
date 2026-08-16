# Mapa de ayuda · sismo del 10 de agosto de 2026

Mapa abierto para registrar y encontrar necesidades tras el sismo M 7.4 con
epicentro en San José del Palmar (Chocó) y los incendios forestales de Nariño.
Cubre Cali, Pereira, Manizales, Armenia, Quibdó y cualquier punto del país.

**En producción:** <https://reconstruyocolombia.com>
(<https://ayuda-sismo.pages.dev> sigue sirviendo lo mismo y es a donde apunta el
dominio: sirve para probar antes de que el DNS propague.)

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
| Busco a una persona | **Manda primero a Medicina Legal y Cruz Roja**, y luego cuándo se vio, edad y si depende de un cuidado |
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

**Una pregunta puede no preguntar nada.** La primera pantalla de *busco a una
persona* no recoge un dato: manda a **Medicina Legal** y a la **Cruz Roja**,
con enlaces, y aclara que no hay que esperar 24 ni 72 horas para denunciar
—que es un mito extendido y cuesta días—. Va **primero y no al final**, porque
después de llenar el formulario la persona ya se fue. Lo respondido ahí (si ya
reportó o no) entra al detalle, y le sirve a quien lea el reporte para ayudarla
a hacerlo.

⚠️ **En personas desaparecidas la fecha NO sube la urgencia**, aunque "la vi
hoy" sea la respuesta más común. Si la recencia, ser menor, ser mayor de 60 y
depender de un medicamento fueran todas alta, prácticamente todo reporte de
persona saldría en alta y la palabra dejaría de significar algo frente a los de
comida y salud, que comparten el mismo mapa. Se reserva para quien es frágil
por edad o por dependencia médica.

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

✅ **Las fotos están ACTIVAS desde el 16-ago-2026.** Estuvieron apagadas un
tiempo porque R2 no estaba habilitado en la cuenta: `caps.fotos` llegaba en
`false` y el campo se escondía solo —ofrecerlo y descartar la imagen en silencio
sería peor—, lo que se notaba sobre todo en "busco a mi mascota", que es donde
la foto vale más que toda la descripción. Si el CLI vuelve a responder
`code: 10042`, es que R2 se desactivó en la cuenta.

Verificado de punta a punta el día que se encendió, con un JPEG de 1.522 KB al
que se le inyectó a propósito un bloque EXIF con coordenadas: llegó a R2 en
**298 KB, sin el GPS y sin marca `Exif`**, se sirvió por `/fotos/{clave}` con
`immutable`, se vio en la ficha del reporte, y al ocultar el reporte por
moderación **la imagen desapareció del bucket** (`The specified key does not
exist`).

⚠️ La ruta pública es **`/fotos/{clave}`**, en plural, y la clave que guarda la
base ya viene con el prefijo `fotos/` incluido (`urlFoto()` solo pega la base de
la API). Pedir `/foto/…` devuelve 404.

**Costo:** con ese peso real, 1.000 fotos son ~0,3 GB, o sea el 3% del free tier
de R2 (10 GB-mes) — cero pesos. Se empezaría a pagar pasando de 10 GB, unas
30.000 fotos, y ahí son 0,015 USD por GB-mes. La salida de datos no se cobra.
Lo que Cloudflare sí exige es una tarjeta registrada para habilitar R2, aunque
todo el consumo quepa en lo gratis.

## La pregunta del lugar cambia según a qué entraste

⚠️ "¿En qué lugar?" se lee al revés cuando alguien va a DAR algo. Quien entra por
donar, ser voluntario, poner transporte u ofrecer apoyo psicológico entiende
"¿a dónde quieres que vaya tu ayuda?", que es la pregunta contraria: lo que se
pide es desde dónde puede ayudar, para cruzarlo con lo que hay cerca.

`preguntaDeLugar(I)` la resuelve por familia, no caso por caso, así que una
opción nueva en "quiero ayudar" hereda el texto correcto sola:

| Entrada | Pregunta |
|---|---|
| Familia **quiero ayudar** (donar, voluntario, psicológico, transporte, mascota hallada) | ¿En dónde estás ubicado? |
| Registrar un acopio | ¿En dónde queda el acopio? |
| Necesito ayuda · ver el mapa | ¿En qué lugar? |

El acopio es la excepción dentro de su familia: ahí no importa dónde está quien
lo registra sino dónde queda el punto al que va a llegar la gente.

## Terminar de llenar el formulario sin perderlo

**⚠️⚠️ El clic en el FONDO no cierra ninguna ventana. Esto no se deshace.** Era
la fuente de una clase entera de accidentes, reportada dos veces con síntomas
distintos: alguien registrando personas atrapadas rozaba el fondo y la ventana
se cerraba sin decir nada, dejándolo en el mapa general con todo lo escrito
perdido y sin saber si había quedado registrado; y en la ventana de donaciones,
un roce devolvía al menú anterior a quien estaba copiando un número de cuenta.
En una emergencia lo primero no es una molestia de usabilidad: es un reporte que
no existe.

Salir es **siempre deliberado**: la equis, el botón de volver, Escape o el atrás
del navegador. Como el fondo dejó de responder, `señalarSalida()` resalta un
instante la equis para que no se sienta que la página se congeló.

`cerrarConAviso()` cubre esas salidas deliberadas: si el formulario está vacío
cierra sin preguntar —no hay qué perder—; si hay algo escrito, pregunta. Solo
mira los campos de TEXTO: los `select` de departamento y municipio llegan
preseleccionados desde la puerta de entrada, así que preguntarían siempre por
algo que la persona no escribió.

⚠️ **Una ventana abierta gana sobre la puerta.** Escape miraba primero si la
puerta estaba visible, y como sigue detrás de la ventana, se saltaba la ventana
de encima: en el panel de donaciones no cerraba nada y de paso tumbaba la
puerta. Ahora se evalúa igual que el atrás del navegador en `retrocederUno()`,
primero las ventanas.

⚠️ En el `popstate` (atrás del navegador) se devuelve `true` aunque la persona
cancele: la entrada del historial ya se consumió y hay que volver a armarla, o
el siguiente atrás se lleva la página entera con el formulario abierto.

**El contacto es obligatorio.** Se registraban reportes sin celular ni correo, y
un reporte así casi no sirve: quien quiere ayudar no tiene cómo avisar que va en
camino ni preguntar la seña que falta, y la persona solo se entera de las
respuestas si conserva el enlace privado —que es justo lo que se pierde al
cerrar la pestaña—. Obligatorio es **dejarlo**, no mostrarlo: sigue sin
publicarse salvo que lo autorice, y en las situaciones sensibles no se publica
nunca (regla 1). El formulario de acopios se deja aparte: ahí lo que hace llegar
a la gente es la dirección, no el teléfono.

## Al terminar: confirmar, no mandar al mapa

La pantalla final es para quien acaba de pedir ayuda. Antes decía "Quedó
publicado" y su botón grande era "Volver al mapa": contaba lo que hizo el sitio
y mandaba a un mapa de puntos a alguien que lo que quiere saber es si va a
llegarle ayuda.

Ahora confirma **qué** quedó registrado (título y lugar), dice **qué sigue** en
tres pasos y —esto es lo que no se puede omitir— dice también **qué no va a
pasar**: acá no se despacha ayuda, y prometerlo sería lo más grave que podría
hacer esta página. El botón principal lleva a *su* reporte, donde verá si
alguien le escribió; el mapa queda como salida discreta.

El paso "cómo te van a contactar" se arma según el caso, porque no es igual para
todos: en las situaciones sensibles el contacto no se publica nunca, y quien lo
publicó sí puede recibir llamadas directas. Un texto único diría algo falso en
la mayoría de los casos.

⚠️ El aviso "te mandamos el enlace al correo" solo se muestra si el servidor
puede cumplirlo (`caps.correo`, que refleja si hay `RESEND_API_KEY`). **Hoy no
la hay**, así que ese correo no sale y el formulario no lo ofrece.

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
agregar `reconstruyocolombia.com` y `www.reconstruyocolombia.com`. El dominio
está registrado en Hostinger pero sus nameservers ya apuntan a Cloudflare, así
que el registro lo crea Cloudflare solo, sin tocar nada en Hostinger.

Al tomar la zona, Cloudflare copió los registros A del parking de Hostinger.
Hay que borrar los de `@` y `www` antes de agregar el dominio propio, o seguirá
sirviéndose la página de parking.

**6. Turnstile**

dash.cloudflare.com → Turnstile → el widget tiene que listar
`reconstruyocolombia.com`, `www.reconstruyocolombia.com` y
`ayuda-sismo.pages.dev` como hostnames permitidos. Si falta el dominio desde el
que se sirve la página, el captcha no monta y los reportes entran marcados
`sin_captcha`. La *site key* va en `CONFIG.TURNSTILE` de `index.html`; la
*secret key* es el `TURNSTILE_SECRET` del paso 2.

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

⚠️ **`/admin/reportes` estuvo devolviendo 500** (`error code: 1101`) porque su
`SELECT` pedía una columna `ciudad` que nunca existió en el esquema —son `depto`
y `municipio`—. O sea que la moderación llevaba caída sin que nada lo dijera: la
única señal era un 500 genérico. El mismo desliz estaba en `/reporte/{id}` de
"Mis reportes", donde no reventaba nada y solo dejaba la línea de ubicación en
blanco. Al renombrar una columna, buscarla en TODO el Worker, no solo donde el
error se ve.

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

- **Fuente**: el **RSS propio de 20 medios** (12 de la zona afectada, 8
  nacionales), en `MEDIOS` dentro de `worker/src/inteligencia.js`. Ya NO se usa
  Google News — ver "Google bloquea la ráfaga" más abajo.
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

### ⚠️⚠️ Google bloquea la ráfaga: por qué el cron devolvía CERO

Diagnosticado el 15-ago-2026. Durante días la corrida programada publicó
`notas:0, medios:0` mientras el disparo manual por HTTP traía 1.146 notas en
dos segundos. **Mismo código, mismo minuto, resultado opuesto.**

**La causa:** Google responde **HTTP 503** con su página
`<title>Sorry...</title>` de bloqueo por consultas automatizadas. No es una
excepción ni un timeout: es un rechazo bien formado que el código convertía en
"no hay noticias".

**El bloqueo es por IP de salida y VARÍA EN EL TIEMPO.** Al principio pegaba
solo al cron —que sale siempre por el mismo centro de datos— mientras la
llamada manual, que sale por otro, respondía 1.146 notas en el mismo minuto.
Horas después, **las dos vías estaban bloqueadas**.

⚠️⚠️ **Y una parte de eso nos la hicimos nosotros.** Diagnosticar el problema
costó ~10 recolecciones de prueba en dos horas y media; con reintentos, más de
300 peticiones a Google News. Es muy probable que eso ampliara el bloqueo a la
segunda IP. **Al depurar esto NO se prueba contra Google en bucle**: se mira la
bitácora de `corridas`, que para eso existe, y se deja pasar el cron.

**Cuatro arreglos:**

1. **No salir en ráfaga.** Tandas de 3 con 900 ms entre tandas y techo de 15 s
   por petición. Nadie está esperando: es un cron cada 3 horas.
2. **Abandonar cuando nos bloquean** (corta-circuitos). Si la primera tanda
   vuelve entera con 503, se abandona la corrida. Y **un 503 no se reintenta**:
   contra un bloqueo por abuso el reintento falla igual y solo duplica las
   peticiones, de 17 a 34, justo cuando nos están diciendo que somos
   demasiados. Medido: una corrida bloqueada pasa de 34 peticiones a **3**.
3. **No publicar una corrida mala.** Cero notas, o más de la mitad de las
   consultas fallidas, **se descarta y NO se escribe**: queda publicada la
   última buena. Antes el agregado vacío se escribía encima del bueno y la
   página quedaba muda sin que nadie se enterara.
4. **Dejar rastro.** Tabla `corridas`: una fila por corrida, salga bien o mal,
   con el detalle por consulta cuando falla (código HTTP, ms, y los primeros
   300 caracteres del cuerpo cuando no es RSS — que es lo que delató el
   "Sorry..."). Se retienen 30 días.

⚠️ **Los arreglos 3 y 4 están verificados contra una corrida programada real**
(06:17 UTC del 15-ago): falló entera, **no publicó**, y quedó anotada con las
17 respuestas. El agregado bueno de 1.145 notas siguió en pie. Los arreglos 1
y 2 reducen la probabilidad de que nos bloqueen, pero **no rescatan una IP ya
bloqueada**: mientras dure, el pulso de prensa se queda con el último dato
bueno y lo declara.

### La salida: RSS propio de cada medio (15-ago-2026)

Se cambió de fuente. Ahora se leen **20 feeds** que los propios periódicos
publican para que los lean: sin buscador de por medio, sin antibot, sin una
cuota secreta que un día se cierra. La lista vive en `MEDIOS`
(`worker/src/inteligencia.js`) con `reg: 1` para los de la zona afectada.

⚠️⚠️ **Cada URL fue PROBADA, no adivinada.** De 38 candidatos escritos de
memoria solo acertaron 12; el resto daba 404 porque la ruta se inventó. Las que
faltaban salieron leyendo el `<link rel="alternate" type="application/rss+xml">`
del home de cada sitio — así aparecieron **El País de Cali (100 items)** y **El
Diario de Pereira (99)**, los dos regionales más importantes de la zona. La
prensa colombiana corre mayoritariamente sobre Arc XP, cuya ruta es
`/arc/outboundfeeds/rss/?outputType=xml`. **Al agregar un medio, probarlo.**

⚠️⚠️ **El filtro por tema es obligatorio y es LA diferencia con Google.** A
Google se le pedía "terremoto Cali" y devolvía solo eso; el feed de un medio
trae todo lo que publicó, incluido el fútbol. `esDelSismo()` exige una palabra
del sismo (sismo, réplica, magnitud…) **o bien** una de emergencia
(damnificados, albergue, acopio…) **junto con** un nombre de la zona. Esa
segunda condición existe porque "ayuda humanitaria" a secas trae Gaza y
"damnificados" trae una inundación en Barranquilla — los dos casos, probados.

⚠️ **El User-Agent lleva token de navegador adelante.** Medido: El Diario de
Pereira responde **403 al UA propio y 200 al híbrido**. Seguimos identificándonos
y dejando URL de contacto; si un medio pide que paremos, se saca de `MEDIOS`.

⚠️ **Infobae contesta 200 desde una IP residencial y 403 desde el Worker**: ahí
el corte es por IP y ningún UA lo arregla. Queda en la lista porque la bitácora
avisa si vuelve, y un caído de 20 no mueve nada.

**Google News queda apagado detrás de `USAR_GOOGLE_NEWS=1`**, con su
corta-circuitos. Si se enciende y falla, **no descarta la corrida**: lo que
manda es el RSS directo.

⚠️⚠️ **Las cifras de antes y de ahora NO son comparables.** Con Google la
lectura daba ~1.145 titulares; con RSS directo da ~294. No es que se haya
perdido cobertura: Google devolvía 17 búsquedas con mucho solapamiento y ruido
de todo el país, y ahora se cuentan las notas del sismo de 20 medios concretos.
El denominador cambió. El hallazgo principal —el silencio— se sostiene: **89 de
101 municipios de la zona sin una sola nota**.

Primera corrida real: **294 notas · 17 medios · 19 de 20 feeds vivos · 12 s**.
Rinde así por medio (`del_feed` → `del sismo`): El País Cali 100→62, El Heraldo
100→33, Semana 100→30, Caracol 100→29, Las2Orillas 150→27, Q'Hubo Cali 12→10.

⚠️ **El `.catch(() => [])` era el verdadero problema.** Convertía "Google me
bloqueó" en "no hay noticias": indistinguibles. Con eso, 17 fallos producían un
agregado de ceros perfectamente bien formado que se publicaba como si nada.
**Al tocar esta recolección, no vuelvas a colapsar el error con el vacío.**

**Ver qué pasó:**

```bash
curl -s .../inteligencia.json | jq .ultima_corrida     # público, en cada respuesta
curl -s .../admin/corridas -H "X-Admin-Token: $ADMIN_TOKEN" | jq   # últimas 40, con detalle
```

`ultima_corrida` viaja en `/inteligencia.json` a propósito: sin él, un agregado
de hace ocho horas se ve exactamente igual que uno recién hecho.

⚠️ Si vuelve a aparecer `503 (Google bloquea consultas automatizadas)` de forma
sostenida, el camino NO es reintentar más —eso alarga el bloqueo—: es espaciar
más las tandas, o cambiar de fuente.

### Acopios: una consulta a D1, no 205

La hoja tiene 205 filas y **ninguna traía coordenada**, así que
`geocodificarPendientes` hacía **un `SELECT` por fila** contra `geocache` —205
consultas secuenciales por corrida, y también en cada visita que refrescara la
copia—. Ahora la caché se lee entera de una sola vez y se resuelve en memoria.

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
