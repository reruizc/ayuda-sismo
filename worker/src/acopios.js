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

// Centro de cada municipio, para ubicar un acopio que no traiga coordenada.
const CENTRO = new Map();
for (const [clave, nombre, dep, , la, lo] of MUNICIPIOS) {
  if (la != null && !CENTRO.has(clave)) CENTRO.set(clave, [nombre, dep, la, lo]);
}

const norm = (s) => String(s || '').toLowerCase()
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
function parsearCSV(txt) {
  const filas = [];
  let fila = [], campo = '', enComillas = false;
  const s = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; }   // comilla escapada
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
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
const LIMPIO = (v) => {
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
    // "cuándo se confirmó que sigue abierto". Es la columna que separa un
    // acopio vivo de uno que cerró hace tres días y nadie ha ido a mirar.
    revision: buscar('ultima revision', 'ultima revisión', 'revisado'),
    tipo:     buscar('tipo de lugar', 'tipo'),
    // Opcionales: si algún día se agregan a la hoja, mandan sobre el centro
    // del municipio y el punto deja de ser aproximado.
    lat:      buscar('lat', 'latitud'),
    lon:      buscar('lon', 'lng', 'longitud'),
  };
}

const BBOX = { latMin: -4.3, latMax: 13.6, lonMin: -82.0, lonMax: -66.8 };

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

export function normalizarFilas(filas) {
  if (!filas.length) return { items: [], sin_ubicar: 0 };
  const ix = indices(filas[0]);
  if (ix.nombre < 0) return { items: [], sin_ubicar: 0, error: 'sin_columna_nombre' };

  const items = [];
  let sinUbicar = 0;
  const g = (f, i) => (i >= 0 ? LIMPIO(f[i]) : '');

  for (let r = 1; r < filas.length; r++) {
    const f = filas[r];
    const nombre = g(f, ix.nombre);
    if (!nombre) continue;                       // fila vacía o de relleno

    const muni = g(f, ix.municipio);
    let la = coordenada(g(f, ix.lat), 'lat');
    let lo = coordenada(g(f, ix.lon), 'lon');
    let aprox = false;
    let dep = g(f, ix.depto);

    if (la == null || lo == null) {
      const c = CENTRO.get(norm(muni));
      if (c) { la = c[2]; lo = c[3]; aprox = true; if (!dep) dep = c[1]; }
      else { la = null; lo = null; sinUbicar++; }
    }
    // Un punto fuera de Colombia es un error de digitación, no una ubicación.
    if (la != null && (la < BBOX.latMin || la > BBOX.latMax ||
                       lo < BBOX.lonMin || lo > BBOX.lonMax)) {
      la = null; lo = null; sinUbicar++;
    }

    const abre = g(f, ix.abre), cierra = g(f, ix.cierra);
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
      h: [abre, cierra].filter(Boolean).join(' a ') || '',
      ab: abre,
      ci: cierra,
      di: g(f, ix.dias),
      vol: /^(s[ií]|x|1|true)$/i.test(g(f, ix.voluntarios)),
      c: g(f, ix.contacto),
      tel: g(f, ix.telefono),
      rev: g(f, ix.revision),
      tipo: g(f, ix.tipo),
      la, lo,
      ap: aprox ? 1 : 0,     // ubicación al centro del municipio, no exacta
    });
  }
  return { items, sin_ubicar: sinUbicar };
}

/* ─────────────────────────── geocodificación ─────────────────────────── */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA_GEO = 'MapaDeAyudaSismo/1.0 (contacto: hola@ricardoruiz.co)';

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
async function geocodificarNombre(nombre, municipio, centro) {
  const q = [nombre, municipio, 'Colombia'].filter(Boolean).join(', ');
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&countrycodes=co&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': UA_GEO } });
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
      if (fila.lat != null) {
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
  const res = { aplicados: 0, cerrados: 0, huerfanos: 0 };
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
    try { porClave.set(f.clave, JSON.parse(f.campos) || {}); } catch { /* fila rota */ }
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
    if (ov.cerrado) { items.splice(i, 1); res.cerrados++; continue; }

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

export async function refrescar(env, opciones = {}) {
  const url = env.ACOPIOS_CSV;
  if (!url) return null;

  const r = await fetch(url, {
    headers: { 'User-Agent': 'MapaDeAyuda/1.0 (+https://reconstruyocolombia.com)' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`hoja http ${r.status}`);
  const txt = await r.text();

  // Si Google devuelve una página de login o de error, llega HTML y no CSV.
  // Guardar eso pisaría la última copia buena con basura.
  if (/^\s*<(!doctype|html)/i.test(txt)) throw new Error('la hoja no es pública');

  const { items, sin_ubicar, error } = normalizarFilas(parsearCSV(txt));
  if (error) throw new Error(error);

  // Las correcciones aprobadas van ANTES de geocodificar: si una corrigió la
  // dirección, el geocodificador tiene que ver la buena.
  const overlays = await aplicarOverlays(env, items);

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
    con_punto_propio: items.filter((i) => !i.ap && i.la != null).length,
    geocodificados_ahora: geocodificados,
    corregidos: overlays.aplicados,
    cerrados: overlays.cerrados,
    revisado: false,       // nadie los ha confirmado en terreno
    items,
  };
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
