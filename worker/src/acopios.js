/**
 * Centros de acopio, desde una hoja de Google que se edita en vivo.
 *
 * La hoja se publica como CSV y el Worker la lee con caché. Así quien coordina
 * agrega un acopio y aparece en el mapa en minutos, sin tocar código ni
 * desplegar nada.
 *
 * ⚠️⚠️ ESTOS DATOS SALEN SIN VERIFICAR y la página lo dice. Un acopio mal
 * anotado manda gente con mercados a una dirección que no existe, así que se
 * marcan "sin revisar" hasta que alguien los confirme en terreno.
 *
 * ⚠️ La hoja publicada es PÚBLICA para cualquiera con el enlace: lo que se
 * escriba en la columna CONTACTO queda a la vista de todo el mundo.
 */
import { MUNICIPIOS } from './municipios.js';
import { centroDe } from './centros.js';
import { vencido, fechaTope, fechaCorta, fechaISO, hoyBogota } from './fechas.js';

// Centro de cada municipio, para ubicar un acopio que no traiga coordenada.
export const CENTRO = new Map();
for (const [clave, nombre, dep, , la, lo] of MUNICIPIOS) {
  if (la != null && !CENTRO.has(clave)) CENTRO.set(clave, [nombre, dep, la, lo]);
}

export const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim();

/**
 * Identidad de un acopio: nombre y municipio normalizados.
 *
 * La hoja NO trae identificador, as\u00ed que esto es lo \u00fanico estable que hay, y
 * ya se ven\u00eda usando como llave del geocache. Ahora tambi\u00e9n amarra las
 * correcciones que manda la gente y las que se aprueban, as\u00ed que tiene que
 * existir en UN solo lugar: si el geocache y las correcciones normalizaran
 * distinto, una correcci\u00f3n aprobada se aplicar\u00eda a un acopio y el punto
 * geocodificado a otro, sin que nada lo dijera.
 *
 * \u26a0\ufe0f Cambiar el NOMBRE en la hoja cambia la llave y deja hu\u00e9rfano lo que
 * colgaba de ella. Por eso el formulario p\u00fablico no deja sugerir el nombre, y
 * el panel muestra aparte las correcciones que se quedaron sin acopio.
 * \u26a0\ufe0f Dos acopios con el mismo nombre en el mismo municipio comparten llave.
 * Es la misma suposici\u00f3n que ya ven\u00eda haciendo el geocache.
 */
export const claveDe = (nombre, municipio) => `${norm(nombre)}|${norm(municipio)}`;

/**
 * Parser de CSV con comillas.
 *
 * No se puede partir por comas: las direcciones traen comas ("Cra 5 #12-30,
 * local 2") y una hoja hecha a mano trae saltos de línea dentro de celdas.
 */
export function parsearCSV(txt) {
  const filas = [];
  let fila = [], campo = '', enComillas = false, campoEnBlanco = true;
  const s = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; }   // comilla escapada
        else enComillas = false;
      } else campo += c;
    } else if (c === '"' && campoEnBlanco) { enComillas = true; campoEnBlanco = false; campo = ''; }
    else if (c === ',') { fila.push(campo); campo = ''; campoEnBlanco = true; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; campoEnBlanco = true; }
    else { campo += c; if (c !== ' ') campoEnBlanco = false; }
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

/**
 * ⚠️ "SIN DATO" es el marcador de ausencia de la hoja, no un valor.
 *
 * Sin esto, una ficha diría "Horario: SIN DATO a SIN DATO" y "Contacto: SIN
 * DATO", que es peor que no decir nada: parece un error de la página y ensucia
 * justo la información por la que alguien la abre.
 */
const AUSENTE = /^(sin dato|sin datos|n\/?a|nd|-|--|n\/d|pendiente)$/i;
export const LIMPIO = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return AUSENTE.test(s) ? '' : s;
};

/** Normaliza el encabezado para no depender de tildes ni mayúsculas. */
function indices(cab) {
  const ix = {};
  cab.forEach((h, i) => { ix[norm(h)] = i; });
  const buscar = (...nombres) => {
    for (const n of nombres) if (ix[n] !== undefined) return ix[n];
    return -1;
  };
  return {
    nombre:   buscar('nombre'),
    municipio: buscar('ciudad o municipio', 'municipio', 'ciudad'),
    depto:    buscar('departamento', 'depto'),
    direccion: buscar('direccion'),
    necesidad: buscar('necesidad', 'recibe', 'que recibe'),
    abre:     buscar('horario abre', 'abre'),
    cierra:   buscar('horario cierre', 'cierra', 'horario cierra'),
    dias:     buscar('todos los dias o lv', 'dias'),
    voluntarios: buscar('requiere voluntarios', 'voluntarios'),
    contacto: buscar('contacto'),
    telefono: buscar('telefono', 'telefono de contacto', 'tel'),
    /* "cuándo se confirmó que sigue abierto": lo que separa un acopio vivo de
       uno que cerró hace tres días y nadie ha ido a mirar.

       ⚠️⚠️ La hoja se rediseñó y `ULTIMA REVISION` desapareció. Como una
       columna que no está acá no da error —solo deja de existir— TODOS los
       acopios salían "sin revisar" mientras alguien hacía el trabajo de
       verificarlos. Es el mismo modo de falla de `ESTADO REGISTRO`.

       ⚠️⚠️ Y la que la reemplaza NO se puede usar tal cual: medido, `FECHA
       ULTIMA VERIFICACION` es igual a `FECHA REPORTE` en 300 de 311 filas (283
       dicen 8/14, el día de la carga). Estamparla como sello diría que alguien
       verificó 279 acopios que nadie tocó — peor que el bug que arregla. Por
       eso la fecha SOLO cuenta cuando `VERIFICADO` dice que sí. */
    revision: buscar('fecha ultima verificacion', 'ultima revision', 'ultima revisión', 'revisado'),
    verificado: buscar('verificado'),
    metodo: buscar('metodo verificacion', 'método verificación'),
    // Si está lleno o tiene cupo. Es justo lo que valoramos de RedAcopio, y
    // resulta que ya estaba en nuestra propia hoja sin que nadie lo leyera.
    cupo: buscar('estado cupo', 'cupo'),
    capacidad: buscar('capacidad'),
    ocupacion: buscar('ocupacion', 'ocupación'),
    // De dónde salió el dato: lo que deja verificar antes de cargar un camión.
    url: buscar('fuente url', 'fuente', 'enlace'),
    org: buscar('organizacion responsable', 'organización responsable'),
    tipo:     buscar('tipo de lugar', 'tipo'),
    // Opcionales: si algún día se agregan a la hoja, mandan sobre el centro
    // del municipio y el punto deja de ser aproximado.
    lat:      buscar('lat', 'latitud'),
    lon:      buscar('lon', 'lng', 'longitud'),
    /* ⚠️⚠️ Esta columna YA EXISTÍA en la hoja y el código NO la leía. Ocho
       puntos marcados a mano como `cerrado` o `descartado` seguían publicados
       en el mapa: alguien hizo el trabajo de revisarlos y no sirvió de nada.
       Al agregar una columna a la hoja hay que agregarla también acá. */
    estado:   buscar('estado registro', 'estado del registro', 'estado'),
  };
}

/**
 * Valores de ESTADO REGISTRO que sacan un punto del mapa.
 *
 * `cerrado` = operó y ya no. `descartado` = no era un acopio, o no se pudo
 * verificar que existiera. Los dos casos terminan igual para quien va con un
 * mercado en el carro, así que los dos se ocultan.
 *
 * ⚠️ `por_verificar` NO oculta: es un punto del que se duda, no uno negado, y
 * esconder lo dudoso en plena emergencia le quita opciones a la gente. Se
 * queda con el sello "sin revisar", que es justo lo que la ficha ya dice.
 */
const ESTADO_OCULTA = new Set(['cerrado', 'cerrada', 'descartado', 'descartada',
  'duplicado', 'duplicada', 'no aplica', 'no existe', 'eliminado', 'eliminada']);

const BBOX = { latMin: -4.3, latMax: 13.6, lonMin: -82.0, lonMax: -66.8 };
const enColombia = (la, lo) => Number.isFinite(la) && Number.isFinite(lo)
  && la >= BBOX.latMin && la <= BBOX.latMax && lo >= BBOX.lonMin && lo <= BBOX.lonMax;

/**
 * Lee una coordenada de la hoja, aunque venga con el punto donde no va.
 *
 * ⚠️⚠️ La hoja es PÚBLICA y la edita gente con configuraciones regionales
 * distintas. Al pegar `4.668272` en un libro donde el punto es separador de
 * MILES, Google Sheets guarda el número 4.668.272 y lo exporta así; con
 * `Number()` eso da NaN y la coordenada se descartaba en silencio. Medido: 162
 * de 162 perdidas, y el mapa mandaba todos los puntos al centro del municipio
 * sin que nadie se enterara.
 *
 * Los dígitos siempre están completos: lo único que se pierde es dónde iba el
 * punto. Y en Colombia la parte entera está acotada —la latitud va de -4,3 a
 * 13,6 y la longitud de -82 a -66,8— así que se prueban las dos posiciones
 * posibles y se acepta SOLO si una cae dentro del país. Si las dos caen (o
 * ninguna), devuelve null: prefiere el centro del municipio, que se declara
 * aproximado, antes que un punto inventado que parece exacto.
 *
 *   '4.668272' → 4.668272      (ya venía bien)
 *   '4.668.272' → 4.668272     (punto como separador de miles)
 *   '4,668,272.00' → 4.668272  (el mismo número en formato de EE. UU.)
 *   '339,018.00' → 3.39018     (33,9018 quedaría fuera de Colombia)
 */
export function coordenada(txt, cual) {
  const s = String(txt ?? '').replace(/\s/g, '');
  if (!s) return null;
  const lo = cual === 'lat' ? BBOX.latMin : BBOX.lonMin;
  const hi = cual === 'lat' ? BBOX.latMax : BBOX.lonMax;
  const enRango = (v) => Number.isFinite(v) && v >= lo && v <= hi;

  const directo = Number(s.replace(',', '.'));
  // Un 0 es la celda vacía a la que alguien le puso formato de número, no la
  // isla nula frente a África.
  if (directo === 0) return null;
  if ((s.match(/[.,]/g) || []).length <= 1 && enRango(directo)) return directo;

  const signo = s.startsWith('-') ? -1 : 1;
  const digitos = s.replace(/\D/g, '');
  if (!digitos) return null;
  const validos = [];
  for (const corte of [1, 2]) {
    if (digitos.length <= corte) continue;
    const v = signo * Number(`${digitos.slice(0, corte)}.${digitos.slice(corte)}`);
    if (enRango(v)) validos.push(v);
  }
  return validos.length === 1 ? validos[0] : null;
}

function ubicacionDe(latCruda, lonCruda, muni, depto) {
  let la = coordenada(latCruda, 'lat');
  let lo = coordenada(lonCruda, 'lon');
  let aprox = false;
  let dep = depto;

  if (la == null || lo == null) {
    const c = CENTRO.get(norm(muni));
    if (c) { la = c[2]; lo = c[3]; aprox = true; if (!dep) dep = c[1]; }
    else {
      /* ⚠️ `CENTRO` sale de `municipios.js`, que solo trae 118 nombres —los
         que el detector de prensa vigila—. Mosquera, Popayán e Ibagué no
         están, y sus acopios quedaban INVISIBLES: ni coordenada propia ni
         centro, o sea fuera del mapa sin que nada lo dijera. `centros.js`
         tiene los 1.125 del país y solo se usa para ubicar. */
      const t = centroDe(muni, depto);
      if (t) { la = t[1]; lo = t[2]; aprox = true; if (!dep) dep = t[0]; }
      else { la = null; lo = null; }
    }
  }
  // Un punto fuera de Colombia es un error de digitación, no una ubicación.
  if (!enColombia(la, lo)) { la = null; lo = null; }
  return { la, lo, aprox, dep };
}

/** Una hora suelta: "18:00", "9:00 AM", "3PM". Sin palabras alrededor. */
const SOLO_HORA = /^\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?\s*m|p\.?\s*m)?\.?$/i;
const aMinutos = (t) => {
  const m = String(t).match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(a|p)?/i);
  if (!m) return null;
  let h = +m[1];
  if (m[3] && /p/i.test(m[3]) && h < 12) h += 12;
  if (m[3] && /a/i.test(m[3]) && h === 12) h = 0;
  return h * 60 + (+m[2] || 0);
};

/**
 * Arma el horario que se muestra, a partir de las dos columnas de la hoja.
 *
 * ⚠️ Unir con `filter(Boolean).join(' a ')` deja frases que mienten. Cuando
 * solo está llena la columna de CIERRE —pasa en 12 de 58 filas con horario— el
 * resultado era "Horario: 18:00", que se lee como la hora de APERTURA. Y
 * "0:00 a 23:59" es la forma más confusa posible de escribir 24 horas.
 *
 * Si lo que queda ya venció, no se publica como horario: sale por `av`, con la
 * fecha aparte, para que la ficha lo rotule como lo que es.
 */
export function horarioDeHoja(abre, cierra, hoy = hoyBogota()) {
  const a = LIMPIO(abre), c = LIMPIO(cierra);
  let h = '';
  if (a && c) {
    const ma = aMinutos(a), mc = aMinutos(c);
    // Medianoche a un minuto de medianoche es "todo el día", escrito por una
    // celda con formato de hora. Decirlo así se entiende; "0:00 a 23:59" no.
    h = (SOLO_HORA.test(a) && SOLO_HORA.test(c) && ma === 0 && mc >= 1435)
      ? '24 horas' : `${a} a ${c}`;
  } else if (c) {
    h = SOLO_HORA.test(c) ? `hasta las ${c}` : c;
  } else if (a) {
    h = SOLO_HORA.test(a) ? `desde las ${a}` : a;
  }
  if (h && vencido(h, hoy)) {
    return { h: '', av: h, av_fecha: fechaCorta(fechaTope(h, hoy)), abre: a, cierra: c };
  }
  return { h, av: '', av_fecha: '', abre: a, cierra: c };
}

export function normalizarFilas(filas) {
  if (!filas.length) return { items: [], sin_ubicar: 0, retirados: [] };
  const ix = indices(filas[0]);
  if (ix.nombre < 0) return { items: [], sin_ubicar: 0, retirados: [], error: 'sin_columna_nombre' };

  const items = [];
  const retirados = [];
  let sinUbicar = 0;
  let ocultos = 0;
  let vencidos = 0;
  const hoy = hoyBogota();
  const g = (f, i) => (i >= 0 ? LIMPIO(f[i]) : '');

  for (let r = 1; r < filas.length; r++) {
    const f = filas[r];
    const nombre = g(f, ix.nombre);
    if (!nombre) continue;                       // fila vacía o de relleno

    // Lo que alguien ya revisó y descartó no vuelve al mapa. Se cuenta, para
    // que se pueda ver desde afuera cuántos se están ocultando.
    if (ESTADO_OCULTA.has(norm(g(f, ix.estado)).replace(/[_-]/g, ' '))) {
      const u = ubicacionDe(g(f, ix.lat), g(f, ix.lon), g(f, ix.municipio), g(f, ix.depto));
      retirados.push({ nombre, lat: u.la, lon: u.lo });
      ocultos++;
      continue;
    }

    const muni = g(f, ix.municipio);
    const { la, lo, aprox, dep } =
      ubicacionDe(g(f, ix.lat), g(f, ix.lon), muni, g(f, ix.depto));
    if (la == null) sinUbicar++;

    const { h, av, av_fecha, abre, cierra } = horarioDeHoja(g(f, ix.abre), g(f, ix.cierra), hoy);
    if (av) vencidos++;

    /* ⚠️ El sello de "revisado" SOLO sale con `VERIFICADO = si`. Ver el aviso
       largo en `indices()`: la fecha viene llena en 279 de 280 filas porque es
       la de carga, y sola diría que alguien confirmó lo que nadie confirmó.
       El método viaja para poder rotularlo con honestidad: hoy los 35 que sí
       están verificados lo están contra el sitio oficial, no en terreno. */
    const verificado = /^(s[ií]|x|1|true)$/i.test(g(f, ix.verificado));
    const cupo = norm(g(f, ix.cupo)).replace(/[_-]/g, ' ');

    items.push({
      // La llave viaja al navegador para que una corrección pueda decir a QUÉ
      // acopio se refiere. Se calcula acá y no en la página: si el cliente la
      // armara, dos normalizaciones distintas mandarían la corrección a otro
      // sitio. El Worker igual la valida contra la lista antes de guardar.
      k: claveDe(nombre, muni),
      n: nombre,
      mu: muni,
      dp: dep,
      d: g(f, ix.direccion),
      ne: g(f, ix.necesidad),
      // `h` es lo que se muestra; `ab`/`ci` son las dos columnas de la hoja.
      // Se conservan separadas porque una corrección de horario tiene que
      // poder volver a la hoja sin adivinar dónde partir "8:00 am a 6:00 pm".
      h,
      // Horario que ya venció. Se conserva rotulado con su fecha porque dice
      // algo ("después suspende operación"), pero fuera del campo de horario.
      av: av || '',
      av_fecha: av_fecha || '',
      ab: abre,
      ci: cierra,
      di: g(f, ix.dias),
      vol: /^(s[ií]|x|1|true)$/i.test(g(f, ix.voluntarios)),
      c: g(f, ix.contacto),
      tel: g(f, ix.telefono),
      rev: verificado ? fechaISO(g(f, ix.revision)) : '',
      rev_metodo: verificado ? g(f, ix.metodo) : '',
      // `con_cupo`/`lleno` de la hoja, en el mismo vocabulario que RedAcopio.
      estado: cupo === 'lleno' ? 'lleno' : (cupo === 'con cupo' ? 'abierto' : ''),
      estado_fuente: (cupo === 'lleno' || cupo === 'con cupo') ? 'hoja' : '',
      url: g(f, ix.url),
      org: g(f, ix.org),
      cap: g(f, ix.capacidad),
      ocu: g(f, ix.ocupacion),
      tipo: g(f, ix.tipo),
      la, lo,
      ap: aprox ? 1 : 0,     // ubicación al centro del municipio, no exacta
    });
  }
  return { items, sin_ubicar: sinUbicar, ocultos, vencidos, retirados,
           columnas_ausentes: Object.keys(ix).filter((k) => ix[k] < 0) };
}

/* ─────────────────────────── geocodificación ─────────────────────────── */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA_GEO = 'MapaDeAyudaSismo/1.0 (contacto: hola@ricardoruiz.co)';
const TOPE_ESPERA_GEO_MS = 10000;

// Un resultado a más de 30 km del centro del municipio es otro sitio con el
// mismo nombre en otra ciudad. Bogotá mide ~40 km de norte a sur, así que el
// umbral tiene que ser generoso hacia adentro y duro hacia afuera.
const MAX_KM_DEL_CENTRO = 30;

function km(la1, lo1, la2, lo2) {
  const dy = (la2 - la1) * 111320;
  const dx = (lo2 - lo1) * 111320 * Math.cos((la1 * Math.PI) / 180);
  return Math.hypot(dx, dy) / 1000;
}

/**
 * Busca el sitio POR NOMBRE en OpenStreetMap.
 *
 * ⚠️⚠️ Por NOMBRE y no por dirección, y la diferencia no es de estilo. Medido:
 * pedirle a Nominatim "Carrera 15 #12-05", "#82-81" y "#180-20" en Bogotá
 * devuelve latitudes 4.6227, 4.7065 y 4.5630 — la #180 al SUR de la #12, cuando
 * las calles suben hacia el norte. No interpola el número; engancha segmentos
 * arbitrarios de la vía, con errores de 5 a 19 km.
 *
 * Por nombre, en cambio, resuelve el PUNTO del lugar (hospital, universidad,
 * coliseo, centro comercial): 9 de 10 en la prueba, con el tipo correcto.
 */
export async function geocodificarNombre(nombre, municipio, centro) {
  const q = [nombre, municipio, 'Colombia'].filter(Boolean).join(', ');
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&countrycodes=co&limit=1`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA_GEO },
    signal: AbortSignal.timeout(TOPE_ESPERA_GEO_MS),
  });
  if (!r.ok) throw new Error(`nominatim http ${r.status}`);
  const d = await r.json();
  if (!Array.isArray(d) || !d.length) return null;

  const la = Number(d[0].lat), lo = Number(d[0].lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  // Sin municipio de referencia no hay con qué validar: se descarta antes que
  // aceptar un homónimo de otra ciudad.
  if (!centro) return null;
  if (km(centro[0], centro[1], la, lo) > MAX_KM_DEL_CENTRO) return null;

  /* ⚠️⚠️ El resultado tiene que PARECERSE al nombre que buscamos.
     Nominatim siempre devuelve algo: pidiéndole "Café Comuna del Café" en
     Pereira contestó una estación de POLICÍA, y "Café Consota" una vía de
     servicio. Un pin preciso en el lugar equivocado es peor que ninguno,
     porque nadie lo puede detectar mirando el mapa.
     Se exige que una palabra significativa del nombre aparezca en el
     display_name de OSM, y se rechazan los tipos que nunca son un acopio. */
  const TIPOS_MALOS = new Set(['service', 'residential', 'primary', 'secondary',
    'tertiary', 'unclassified', 'track', 'path', 'footway', 'yes', 'locality',
    'suburb', 'neighbourhood', 'administrative', 'city', 'town']);
  if (TIPOS_MALOS.has(d[0].type)) return null;

  const VACIAS = new Set(['cafe', 'centro', 'punto', 'acopio', 'sede', 'sitio',
    'lugar', 'casa', 'banco', 'fundacion', 'principal', 'nacional', 'colombia',
    'norte', 'sur', 'este', 'oeste', 'nueva', 'nuevo', 'para', 'de', 'del',
    'la', 'el', 'los', 'las', 'y',
    // Genéricos de la geografía colombiana: "comuna" hizo pasar "Café Comuna
    // del Café" como una estación de policía, porque el nombre de esa
    // estación también lleva la palabra.
    'comuna', 'barrio', 'vereda', 'corregimiento', 'municipio', 'ciudad',
    'plaza', 'plazoleta', 'parque', 'calle', 'carrera', 'avenida', 'auxiliares',
    'publica', 'publico', 'colombiana', 'colombiano']);
  const propias = norm(nombre).split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4 && !VACIAS.has(w));
  if (!propias.length) return null;              // nombre sin nada distintivo
  const encontrado = norm(d[0].display_name || '');
  if (!propias.some((w) => encontrado.includes(w))) return null;

  return { la, lo, tipo: d[0].type || '' };
}

/**
 * Resuelve por nombre los acopios que solo tienen el centro del municipio.
 *
 * Corre en el CRON, no en la petición: son consultas de ~1 s cada una y nadie
 * puede esperar eso al abrir el mapa. Lo que ya está en caché se aplica
 * instantáneo en cualquier refresco.
 */
async function geocodificarPendientes(env, items, max) {
  let usados = 0;

  /* ⚠️ La caché se lee DE UNA, no fila por fila.
     Antes esto hacía un SELECT por acopio: con 205 acopios en la hoja eran 205
     consultas secuenciales a D1 en cada corrida —y en cada visita que
     refrescara la copia—, cuando la tabla entera son unos cientos de filas
     que caben de sobra en memoria. Una consulta en vez de 205. */
  const cache = new Map();
  try {
    const r = await env.DB.prepare('SELECT clave, lat, lon, fuente FROM geocache').all();
    for (const f of r.results || []) cache.set(f.clave, f);
  } catch (e) {
    console.error('geocache ilegible', e && e.message);   // se sigue sin caché
  }

  for (const a of items) {
    if (!a.ap || !a.n) continue;                 // ya tiene punto propio
    const clave = a.k || claveDe(a.n, a.mu);
    const fila = cache.get(clave);

    if (fila) {
      // lat NULL = ya se buscó y no se encontró. No se vuelve a preguntar.
      if (fila.lat != null && enColombia(fila.lat, fila.lon)) {
        a.la = fila.lat; a.lo = fila.lon; a.ap = 0; a.geo = fila.fuente || 'osm';
      }
      continue;
    }

    if (usados >= max) continue;                 // el resto, en la próxima corrida
    usados++;
    const centro = CENTRO.get(norm(a.mu));
    let res = null;
    try {
      res = await geocodificarNombre(a.n, a.mu, centro ? [centro[2], centro[3]] : null);
    } catch (e) {
      console.error('geocode falló', a.n, e && e.message);
      continue;                                  // sin guardar: se reintenta luego
    }

    try {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO geocache (clave, lat, lon, fuente, ts) VALUES (?,?,?,?,?)'
      ).bind(clave, res ? res.la : null, res ? res.lo : null,
             res ? `osm:${res.tipo}` : null, Date.now()).run();
    } catch { /* si no se puede cachear, igual se usa el resultado */ }
    // También en el mapa en memoria: la hoja puede traer el mismo sitio dos
    // veces y sin esto la segunda aparición volvería a preguntarle a OSM.
    cache.set(clave, { clave, lat: res ? res.la : null, lon: res ? res.lo : null,
                       fuente: res ? `osm:${res.tipo}` : null });

    if (res) { a.la = res.la; a.lo = res.lo; a.ap = 0; a.geo = `osm:${res.tipo}`; }

    // Política de Nominatim: máximo una petición por segundo.
    if (usados < max) await new Promise((r) => setTimeout(r, 1100));
  }
  return usados;
}

/* ───────────────────── correcciones aprobadas (overlay) ───────────────────── */

/**
 * Campos que una corrección aprobada puede pintar encima de la fila de la hoja.
 *
 * ⚠️ El NOMBRE no está y no puede estar: es la llave. Cambiarlo desde acá
 * rompería el vínculo con la corrección que lo cambió. Un cambio de nombre se
 * pide por la nota y se hace en la hoja.
 * ⚠️ La UBICACIÓN tampoco: mover un pin desde una sugerencia anónima manda
 * gente a otra dirección. El punto sale de la hoja o del geocodificador.
 */
const CAMPOS_OVERLAY = ['d', 'ne', 'ab', 'ci', 'di', 'tel', 'c', 'rev', 'tipo', 'vol'];

/**
 * Aplica sobre los acopios lo que ya se aprobó en el panel.
 *
 * Existe porque el Worker NO puede escribir en la hoja de Google: sin esto,
 * aprobar una corrección no cambiaría nada en el mapa hasta que alguien la
 * transcribiera a mano, que es justo la demora que hace que un acopio cerrado
 * siga recibiendo gente.
 *
 * ⚠️⚠️ Se limpia solo. Cuando el valor aprobado YA aparece igual en la hoja,
 * ese campo se borra del overlay; si no queda ninguno, se borra la fila. Sin
 * esa limpieza el overlay sería permanente y una corrección vieja seguiría
 * ganándole a la hoja para siempre — o sea, editar la hoja dejaría de servir
 * sin que nada avisara. Así el overlay es un puente, no una bifurcación.
 *
 * ⚠️ Solo se borra lo REDUNDANTE, nunca lo huérfano: si la hoja falla o la
 * fila desaparece un rato, el overlay tiene que sobrevivir.
 */
export async function aplicarOverlays(env, items) {
  const res = { aplicados: 0, cerrados: 0, huerfanos: 0, retirados: [] };
  let filas = [];
  try {
    const r = await env.DB.prepare('SELECT clave, campos FROM acopio_overlay').all();
    filas = r.results || [];
  } catch (e) {
    // Tabla ausente (esquema sin aplicar) o D1 caído: el mapa sigue con la
    // hoja tal cual. Perder las correcciones es malo; quedarse sin acopios es
    // peor.
    console.error('overlays ilegibles', e && e.message);
    return res;
  }
  if (!filas.length) return res;

  const porClave = new Map();
  for (const f of filas) {
    try {
      const campos = JSON.parse(f.campos);
      if (campos && typeof campos === 'object' && !Array.isArray(campos)) {
        porClave.set(f.clave, campos);
      }
    } catch { /* fila rota */ }
  }

  const vistos = new Set();
  const redundantes = [];      // [clave, campos que la hoja ya trae iguales]

  for (let i = items.length - 1; i >= 0; i--) {
    const a = items[i];
    const ov = porClave.get(a.k);
    if (!ov) continue;
    vistos.add(a.k);

    // Cerrado: sale del mapa entero. No basta con marcarlo — quien mira el
    // mapa a las 6 a.m. no lee etiquetas, ve un pin y arranca para allá.
    if (ov.cerrado) {
      res.retirados.push({ nombre: a.n, lat: a.la, lon: a.lo });
      items.splice(i, 1); res.cerrados++; continue;
    }

    let cambio = false;
    const iguales = [];
    for (const c of CAMPOS_OVERLAY) {
      if (!(c in ov)) continue;
      if (c === 'vol') {
        if (!!ov.vol === !!a.vol) { iguales.push(c); continue; }
        a.vol = !!ov.vol;
      } else {
        const nuevo = String(ov[c] ?? '');
        if (nuevo === String(a[c] ?? '')) { iguales.push(c); continue; }
        a[c] = nuevo;
      }
      cambio = true;
    }
    if (cambio) {
      a.h = [a.ab, a.ci].filter(Boolean).join(' a ');
      a.ed = 1;                       // corregido por moderación, no por la hoja
      res.aplicados++;
    }
    if (iguales.length) redundantes.push([a.k, iguales]);
  }

  res.huerfanos = [...porClave.keys()].filter((k) => !vistos.has(k)).length;

  for (const [clave, campos] of redundantes) {
    const ov = porClave.get(clave);
    for (const c of campos) delete ov[c];
    try {
      if (!Object.keys(ov).length) {
        await env.DB.prepare('DELETE FROM acopio_overlay WHERE clave = ?').bind(clave).run();
      } else {
        await env.DB.prepare('UPDATE acopio_overlay SET campos = ? WHERE clave = ?')
          .bind(JSON.stringify(ov), clave).run();
      }
    } catch (e) { console.error('overlay no se pudo limpiar', clave, e && e.message); }
  }
  return res;
}

const TOPE_ESPERA_HOJA_MS = 20000;
const TOPE_TAMANO_HOJA = 8 * 1024 * 1024;

export const GUARDA_ACOPIOS = {
  minimoPublicable: 40,
  fraccionDelAnterior: 0.5,
  graciaAntesDeAceptarMs: 3 * 60 * 60 * 1000,
};

export async function copiaGuardada(env, id) {
  try {
    const row = await env.DB.prepare('SELECT datos FROM externos WHERE id = ?').bind(id).first();
    return row?.datos ? JSON.parse(row.datos) : null;
  } catch { return null; }
}

export function evaluarRefresco(traidos, publicadosAntes, umbrales, edadCopiaMs) {
  const minimoExigido = publicadosAntes
    ? Math.max(umbrales.minimoPublicable,
               Math.ceil(publicadosAntes * umbrales.fraccionDelAnterior))
    : 0;
  if (traidos >= minimoExigido) return { conservar: false, aceptado_por_gracia: false };

  const graciaVencida = traidos > 0 && edadCopiaMs > umbrales.graciaAntesDeAceptarMs;
  return {
    conservar: !graciaVencida,
    aceptado_por_gracia: graciaVencida,
    aviso: { traidos, minimo_exigido: minimoExigido, publicados_antes: publicadosAntes },
  };
}

export async function refrescar(env, opciones = {}) {
  const url = env.ACOPIOS_CSV;
  if (!url) return null;

  const guardado = await copiaGuardada(env, 'acopios');

  const r = await fetch(url, {
    headers: { 'User-Agent': 'MapaDeAyuda/1.0 (+https://reconstruyocolombia.com)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TOPE_ESPERA_HOJA_MS),
  });
  if (!r.ok) throw new Error(`hoja http ${r.status}`);
  const txt = await r.text();
  if (txt.length > TOPE_TAMANO_HOJA) throw new Error(`hoja demasiado grande: ${txt.length}`);

  // Si Google devuelve una página de login o de error, llega HTML y no CSV.
  // Guardar eso pisaría la última copia buena con basura.
  if (/^\s*<(!doctype|html)/i.test(txt)) throw new Error('la hoja no es pública');

  const { items, sin_ubicar, ocultos, vencidos, retirados, columnas_ausentes, error } =
    normalizarFilas(parsearCSV(txt));
  if (error) throw new Error(error);

  // Las correcciones aprobadas van ANTES de geocodificar: si una corrigió la
  // dirección, el geocodificador tiene que ver la buena.
  const overlays = await aplicarOverlays(env, items);
  retirados.push(...overlays.retirados);

  // La caché se aplica siempre (es instantánea); las búsquedas nuevas solo
  // cuando quien llama las pide, porque cuestan ~1 s cada una.
  let geocodificados = 0;
  try {
    geocodificados = await geocodificarPendientes(env, items, opciones.geocodificar || 0);
  } catch (e) {
    console.error('geocodificación falló entera', e && e.message);
  }

  const datos = {
    generado: Date.now(),
    total: items.length,
    sin_ubicar,
    // Cuántos sacó de la hoja la columna ESTADO REGISTRO. Se publica para que
    // se pueda ver desde afuera: ocultar en silencio es como no leer.
    ocultos_por_estado: ocultos || 0,
    // Horarios con fecha ya pasada que dejaron de publicarse como vigentes.
    // Se publica el conteo: si sube, hay acopios cuyo dato quedó congelado.
    horarios_vencidos: vencidos || 0,
    columnas_ausentes: columnas_ausentes || [],
    con_punto_propio: items.filter((i) => !i.ap && i.la != null).length,
    // Con sello real de verificación (VERIFICADO = si), no con la fecha de carga.
    verificados: items.filter((i) => i.rev).length,
    geocodificados_ahora: geocodificados,
    corregidos: overlays.aplicados,
    cerrados: overlays.cerrados,
    revisado: false,       // nadie los ha confirmado en terreno
    retirados,
    items,
  };
  const guarda = evaluarRefresco(datos.total, guardado?.total || 0, GUARDA_ACOPIOS,
                                 guardado?.generado ? Date.now() - guardado.generado : 0);
  if (guarda.conservar) {
    console.error('acopios: refresco descartado', JSON.stringify(guarda.aviso));
    return { ...guardado, refresco_descartado: guarda.aviso };
  }
  if (guarda.aceptado_por_gracia) datos.encogimiento_aceptado = guarda.aviso;

  await env.DB.prepare(
    `INSERT INTO externos (id, ts, datos) VALUES ('acopios', ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, datos = excluded.datos`
  ).bind(datos.generado, JSON.stringify(datos)).run();
  return datos;
}

/**
 * Devuelve los acopios, refrescando si la copia guardada ya envejeció.
 *
 * ⚠️ Si la hoja falla se sirve LA ÚLTIMA COPIA BUENA. Una edición que deje la
 * hoja vacía o rota no puede dejar el mapa sin acopios en plena emergencia.
 */
export async function leer(env, maxEdadMs = 300000) {
  let guardado = null;
  try {
    const row = await env.DB.prepare("SELECT datos FROM externos WHERE id = 'acopios'").first();
    if (row?.datos) guardado = JSON.parse(row.datos);
  } catch { /* sigue con guardado en null */ }

  const viejo = !guardado || (Date.now() - guardado.generado) > maxEdadMs;
  if (!viejo) return guardado;

  try {
    const fresco = await refrescar(env);
    if (fresco) return fresco;
  } catch (e) {
    console.error('acopios: no se pudo refrescar', e && e.message);
    if (guardado) return { ...guardado, degradado: true };
    return { generado: Date.now(), total: 0, items: [], revisado: false, error: true };
  }
  return guardado || { generado: Date.now(), total: 0, items: [], revisado: false };
}
