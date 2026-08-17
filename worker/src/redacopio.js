/**
 * RedAcopio Bogotá · lectura de su página.
 *
 * Ellos verifican en terreno y publican algo que nosotros NO tenemos: si cada
 * punto está **abierto, cerrado o lleno**. Nuestra hoja no se entera sola de
 * que un acopio dejó de operar — nos enteramos cuando alguien va hasta allá y
 * se toma el trabajo de escribirnos, que fue lo que pasó con Samu Norte, tres
 * días tarde.
 *
 * ⚠️⚠️ ESTO LEE EL HTML DE SU PÁGINA, NO UNA API. No la hay: su sitio es un
 * Next.js que sirve los datos dentro del documento y no expone ninguna ruta
 * `/api/`. Es frágil por definición — el día que cambien su build, el formato
 * cambia y esto deja de encontrar registros. Por eso:
 *
 *   · Se lee UNA vez cada 3 horas, en el cron, nunca por visita.
 *   · Si una corrida trae mucho menos de lo que traía la anterior, se DESCARTA
 *     y se conserva la última copia buena (`GUARDA_MINIMA`). Un parseo roto no
 *     puede borrar 86 puntos del mapa en silencio.
 *   · Cada punto que sale de acá viaja marcado `fuente:'redacopio'` para poder
 *     darles el crédito en la ficha y para poder apagarlo entero si hace falta.
 *
 * ⚠️ Se lee con permiso: ellos propusieron integrar sus datos con los nuestros.
 * Si esa conversación cambia, se apaga quitando `REDACOPIO_URL` del entorno.
 */
import { norm } from './acopios.js';

const UA = 'MapaDeAyuda/1.0 (+https://reconstruyocolombia.com; hola@ricardoruiz.co)';

/** Si una corrida trae menos de esta fracción de la anterior, no se publica. */
const GUARDA_MINIMA = 0.6;
/** Piso absoluto: por debajo de esto el parseo está roto, no es que cerraran. */
const MINIMO_ABSOLUTO = 20;

/**
 * Saca los registros del documento.
 *
 * El payload viene como cadenas de JavaScript con las comillas escapadas. Se
 * desescapa, se buscan las apariciones de un campo que solo existe en estos
 * registros, y desde cada una se retrocede hasta la llave de apertura y se
 * balancea. Es tosco a propósito: no depende de la forma del árbol de React,
 * que es justo lo que cambia entre builds.
 */
export function extraer(html) {
  const s = String(html || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const vistos = new Set();
  const items = [];

  for (const m of s.matchAll(/"authorizing_entity"/g)) {
    let i = m.index;
    while (i > 0 && s[i] !== '{') i--;
    if (s[i] !== '{') continue;
    let prof = 0, fin = -1;
    for (let j = i; j < Math.min(s.length, i + 6000); j++) {
      if (s[j] === '{') prof++;
      else if (s[j] === '}') { prof--; if (prof === 0) { fin = j; break; } }
    }
    if (fin < 0) continue;
    let o;
    try { o = JSON.parse(s.slice(i, fin + 1)); } catch { continue; }
    if (!o || !o.name || !o.id || vistos.has(o.id)) continue;
    vistos.add(o.id);
    items.push(o);
  }
  return items;
}

/** Su vocabulario de estado → el nuestro. */
function estadoDe(o) {
  const st = norm(o.status);
  // `community_status` lo reporta la gente y es más fresco que el operativo:
  // si alguien acaba de decir que está lleno, eso manda sobre "abierto".
  const com = norm(o.community_status);
  if (st === 'cerrado') return 'cerrado';
  if (com === 'lleno' || st === 'lleno') return 'lleno';
  if (st === 'abierto') return 'abierto';
  return '';
}

/** Un registro suyo, en la forma que ya entiende el frontend de acopios. */
function aNuestraForma(o) {
  const needs = Array.isArray(o.needs) ? o.needs.filter(Boolean) : [];
  const vol = o.vol && typeof o.vol === 'object' ? o.vol : null;
  const c = o.contact && typeof o.contact === 'object' ? o.contact : {};
  return {
    // La llave lleva prefijo para que NUNCA choque con la de nuestra hoja:
    // son dos universos de identidad distintos y fundirlos por accidente
    // mandaría una corrección nuestra a un punto de ellos.
    k: `ra:${o.id}`,
    ra_id: o.id,
    n: String(o.name).trim(),
    mu: 'Bogotá',
    dp: 'Bogotá D.C.',
    d: String(o.address || '').trim(),
    ne: needs.join(', '),
    h: String(o.hours || '').trim() === 'Por confirmar' ? '' : String(o.hours || '').trim(),
    vol: !!(vol && vol.need),
    vol_cupos: vol && Number.isFinite(vol.target)
      ? { objetivo: vol.target, actual: Number(vol.current) || 0 } : null,
    c: String(c.name || c.contacto || '').trim(),
    tel: String(c.phone || c.tel || '').trim(),
    la: Number.isFinite(o.lat) ? o.lat : null,
    lo: Number.isFinite(o.lng) ? o.lng : null,
    ap: 0,                              // ellos sí traen coordenada del sitio
    // Lo que ellos aportan y nuestra hoja no tiene.
    estado: estadoDe(o),
    flujo: norm(o.flow) || '',
    oficial: norm(o.source) === 'oficial' ? 1 : 0,
    rev: String(o.verified_at || '').slice(0, 10),
    fuente: 'redacopio',
  };
}

export async function refrescar(env) {
  const url = env.REDACOPIO_URL;
  if (!url) return null;

  let guardado = null;
  try {
    const row = await env.DB.prepare("SELECT datos FROM externos WHERE id = 'redacopio'").first();
    if (row?.datos) guardado = JSON.parse(row.datos);
  } catch { /* primera corrida */ }

  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`redacopio http ${r.status}`);
  const crudos = extraer(await r.text());

  /* ⚠️⚠️ La guarda es la razón de ser de este bloque. Leer el HTML de otro
     sitio se rompe CALLADO: un cambio en su build no da error, simplemente
     deja de encontrar registros, y sin esto publicaríamos cero puntos como si
     hubieran cerrado todos. Se conserva la última copia buena y queda anotado
     en `corridas` para poder verlo desde afuera. */
  const antes = guardado?.total || 0;
  if (crudos.length < MINIMO_ABSOLUTO || (antes && crudos.length < antes * GUARDA_MINIMA)) {
    throw new Error(`parseo sospechoso: ${crudos.length} registros (antes ${antes})`);
  }

  const items = crudos.map(aNuestraForma).filter((x) => x.la != null);
  const datos = {
    generado: Date.now(),
    total: items.length,
    crudos: crudos.length,
    sin_punto: crudos.length - items.length,
    abiertos: items.filter((x) => x.estado === 'abierto').length,
    cerrados: items.filter((x) => x.estado === 'cerrado').length,
    llenos: items.filter((x) => x.estado === 'lleno').length,
    fuente: 'RedAcopio Bogotá',
    fuente_url: 'https://redacopiobogota.com',
    items,
  };
  await env.DB.prepare(
    `INSERT INTO externos (id, ts, datos) VALUES ('redacopio', ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, datos = excluded.datos`
  ).bind(datos.generado, JSON.stringify(datos)).run();
  return datos;
}

export async function leer(env) {
  try {
    const row = await env.DB.prepare("SELECT datos FROM externos WHERE id = 'redacopio'").first();
    if (row?.datos) return JSON.parse(row.datos);
  } catch { /* cae abajo */ }
  return { generado: 0, total: 0, items: [], fuente: 'RedAcopio Bogotá' };
}

/* ───────────────────── fusión con nuestros acopios ───────────────────── */

const km = (a, b, c, d) => {
  const dy = (c - a) * 111.32;
  const dx = (d - b) * 111.32 * Math.cos((a * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

/** Palabras que no distinguen a un acopio de otro. */
const VACIAS = new Set(['centro', 'punto', 'acopio', 'sede', 'casa', 'de', 'del', 'la', 'el',
  'los', 'las', 'y', 'para', 'bogota', 'colombia', 'fundacion', 'cruz', 'roja']);
const tokens = (s) => new Set(norm(s).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 3 && !VACIAS.has(w)));

/**
 * Cruza lo de RedAcopio con nuestra hoja.
 *
 * ⚠️⚠️ La deduplicación es lo único que puede salir MAL de verdad acá. Medido:
 * 45 de sus 86 puntos ya están en nuestra hoja. Si se duplican, el mapa
 * muestra dos pines del mismo sitio con datos distintos; si se funden dos
 * sitios distintos, se manda gente a la puerta equivocada.
 *
 * Se cruza por DOS señales y se exige una de las dos, nunca el parecido suelto:
 *   · dos palabras distintivas en común en el nombre, Y a menos de 1,2 km, o
 *   · a menos de 120 m, que en una ciudad es la misma esquina.
 *
 * Lo que ya tenemos NO se reemplaza: se ENRIQUECE con lo que ellos saben y
 * nosotros no (si está abierto, cerrado o lleno). Nuestra dirección, horario y
 * contacto mandan, porque son los que la gente ya corrigió. Los que no
 * casan entran como puntos nuevos, marcados con su fuente.
 */
export function fusionar(nuestros, suyos) {
  const res = { enriquecidos: 0, nuevos: 0, candidatos: [], omitidos: 0 };
  if (!Array.isArray(suyos) || !suyos.length) return res;

  const conCoord = nuestros.filter((a) => a.la != null && !a.ap);
  for (const x of suyos) {
    const tx = tokens(x.n);
    let par = null;
    for (const a of conCoord) {
      const d = km(x.la, x.lo, a.la, a.lo);
      if (d > 1.2) continue;
      if (d < 0.12) { par = a; break; }
      let comunes = 0;
      for (const w of tokens(a.n)) if (tx.has(w)) comunes++;
      if (comunes >= 2) { par = a; break; }
    }

    if (par) {
      // Solo lo que ellos saben y nosotros no. Nada de pisar la dirección.
      if (x.estado) { par.estado = x.estado; par.estado_fuente = 'redacopio'; }
      if (x.flujo) par.flujo = x.flujo;
      if (x.vol_cupos) par.vol_cupos = x.vol_cupos;
      if (!par.rev && x.rev) { par.rev = x.rev; par.rev_fuente = 'redacopio'; }
      res.enriquecidos++;

      /* ⚠️⚠️ Un punto NUESTRO que ellos dan por cerrado NO se borra acá.
         Borrar en automático, con un dato leído raspando la página de un
         tercero, es demasiado poder para una tubería frágil: un cambio en su
         build o un cruce mal hecho sacaría acopios que sí están operando.
         Se marca en el mapa y se propone como CANDIDATO para que alguien lo
         escriba en la columna ESTADO REGISTRO de la hoja, que es donde el
         cierre queda con dueño. Mismo principio del panel de correcciones. */
      if (x.estado === 'cerrado') {
        res.candidatos.push({ k: par.k, n: par.n, mu: par.mu, d: par.d,
                              segun: x.n, ra_id: x.ra_id });
      }
    } else if (x.estado === 'cerrado') {
      /* Cerrado y que además NO tenemos: no se agrega. Un pin nuevo que dice
         "cerrado" no le sirve a quien está buscando a dónde llevar un mercado;
         es ruido en el mapa justo donde estorba. */
      res.omitidos++;
    } else {
      nuestros.push({ ...x });
      res.nuevos++;
    }
  }
  return res;
}
