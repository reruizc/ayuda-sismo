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

/** El recuadro de Colombia, para descartar coordenadas que no lo son. */
const BBOX = { latMin: -4.3, latMax: 13.6, lonMin: -82.0, lonMax: -66.8 };
const enColombia = (la, lo) =>
  Number.isFinite(la) && Number.isFinite(lo)
  && la >= BBOX.latMin && la <= BBOX.latMax
  && lo >= BBOX.lonMin && lo <= BBOX.lonMax;

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

/**
 * Su campo `hours` NO siempre es un horario.
 *
 * ⚠️ Medido sobre sus 96 puntos: junto a "8 am. 9pm" y "24h" conviven
 * "Lunes festivo SOLO voluntarios - NO donaciones.", "Se requieren voluntarios
 * para cargar camión" y "7am a 10:30pm - 3009003386", con el teléfono pegado.
 * Es un cajón de notas, no una hora. Metido tal cual en nuestro campo de
 * horario produciría fichas que dicen "Horario: Se requieren voluntarios para
 * cargar camión", que se lee como un error de la página.
 *
 * Lo que parece hora va al horario; lo demás va aparte, rotulado como nota de
 * ellos. En la duda, nota: una nota mal puesta se entiende igual, un horario
 * inventado manda a alguien a una puerta cerrada.
 */
const PARECE_HORA = /\d\s*(?:a\.?\s*m|p\.?\s*m|h(?:ora)?s?\b|:\s*\d)/i;

/**
 * ⚠️ Sus marcadores de ausencia. Medido: un punto solo (`.`) aparece en 5 de
 * sus 96 puntos, y "Confirmar"/"Consultar" en otros 3. Es el mismo problema
 * del "SIN DATO" de nuestra hoja: no son valores, son huecos, y publicarlos
 * produce fichas que dicen "Horario: ." — que se lee como algo roto.
 */
const RA_AUSENTE = /^(?:[.\-–—·]+|por confirmar|confirmar|consultar|n\/?a|sin dato)$/i;

export function horarioDe(txt) {
  let t = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!t || RA_AUSENTE.test(t)) return { h: '', nota: '', tel: '' };
  // Teléfono pegado al final: va al campo de teléfono, no al de horario.
  const tel = t.match(/(?:\+?57)?\s*(3\d{9})\s*$/);
  if (tel) t = t.slice(0, tel.index).replace(/[\s\-–—·,]+$/, '').trim();
  if (!t || RA_AUSENTE.test(t)) return { h: '', nota: '', tel: tel ? tel[1] : '' };
  /* El tope es generoso (120) a propósito: sus horarios buenos vienen con
     matices que valen —"8am a 8pm - Lunes Festivo estará funcionando", "8:00
     a.m. a 5:00 p.m. (posible extensión hasta las 8pm)"— y un tope corto los
     mandaba a nota, escondiendo justo la hora. Lo que NO trae una hora
     ("Lunes festivo SOLO voluntarios", "YA NO RECIBE DONACIONES") sigue
     yéndose a nota, que es donde se entiende igual. */
  const esHora = PARECE_HORA.test(t) && t.length <= 120;
  return { h: esHora ? t : '', nota: esHora ? '' : t, tel: tel ? tel[1] : '' };
}

/** Un registro suyo, en la forma que ya entiende el frontend de acopios. */
function aNuestraForma(o) {
  const needs = Array.isArray(o.needs) ? o.needs.filter(Boolean) : [];
  const vol = o.vol && typeof o.vol === 'object' ? o.vol : null;
  const c = o.contact && typeof o.contact === 'object' ? o.contact : {};
  const hor = horarioDe(o.hours);
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
    h: hor.h,
    // Lo que su campo de horario traía y no era una hora. Se muestra rotulado.
    nota_ra: hor.nota,
    vol: !!(vol && vol.need),
    vol_cupos: vol && Number.isFinite(vol.target)
      ? { objetivo: vol.target, actual: Number(vol.current) || 0 } : null,
    c: String(c.name || c.contacto || '').trim(),
    tel: String(c.phone || c.tel || '').trim() || hor.tel || '',
    /* ⚠️⚠️ `Number.isFinite(0)` es true, así que un 0,0 pasaba como
       coordenada válida: 4 de sus 96 puntos vienen así y dos de ellos
       —Unicentro y Fundación El Combo— estaban publicados en el golfo de
       Guinea. Es la misma trampa que `coordenada()` ya cuida del lado de la
       hoja: un cero es una celda vacía con formato de número, no la isla nula.
       Se valida contra el recuadro de Colombia, no solo contra "es finito". */
    la: enColombia(o.lat, o.lng) ? o.lat : null,
    lo: enColombia(o.lat, o.lng) ? o.lng : null,
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

      /* ⚠️ RELLENA HUECOS, NUNCA PISA. Nuestra hoja la corrige gente que fue
         al sitio y el panel de correcciones escribe encima de ella; si lo de
         ellos ganara, una corrección aprobada se desharía sola en la
         siguiente lectura. Solo entra donde no teníamos nada — y son 13 sin
         horario y 20 sin necesidad, de 29 compartidos. */
      if (!par.h && x.h) { par.h = x.h; par.h_fuente = 'redacopio'; }
      if (!par.ne && x.ne) { par.ne = x.ne; par.ne_fuente = 'redacopio'; }
      if (!par.tel && x.tel) par.tel = x.tel;
      if (x.nota_ra) par.nota_ra = x.nota_ra;
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
