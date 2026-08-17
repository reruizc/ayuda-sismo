/**
 * Quién PIDE ayuda, desde la pestaña NECESIDADES de la misma hoja.
 *
 * Es la contraparte de los centros de acopio y por eso vive aparte: un acopio
 * es un sitio que RECIBE, y esto es una organización que dice qué le HACE
 * FALTA. Mezclarlos en una sola lista haría que alguien con un mercado en el
 * carro no pudiera distinguir a dónde entregarlo de quién lo está pidiendo.
 *
 * Mismo contrato que `acopios.js`: la hoja se edita en vivo, el Worker la lee
 * con caché y conserva la última copia buena. La URL sale de una variable de
 * entorno (`NECESIDADES_CSV`) para que otra organización pueda apuntar a la
 * suya sin tocar código.
 *
 * ⚠️⚠️ SIN VERIFICAR, igual que los acopios. Acá el riesgo es simétrico: una
 * necesidad vieja o mal anotada hace que llegue lo que ya no falta.
 */
import { CENTRO, norm, parsearCSV, LIMPIO, geocodificarNombre, coordenada } from './acopios.js';
import { centroDe } from './centros.js';

/* ─────────────────────────────── identidad ─────────────────────────────── */

/**
 * ⚠️⚠️ La hoja trae varias filas por organización, y significan DOS cosas
 * distintas que hay que separar antes de pintar un punto:
 *
 *   a) SEDES de verdad. "Chocopan por una sonrisa" tiene cuatro filas con
 *      cuatro direcciones en vías distintas (Cra 34 #11-41, Cra 98A #73-03,
 *      Av. Ciudad de Cali #88-81, Cra 59A #129-30) y la misma necesidad. Son
 *      cuatro puntos y hay que mostrar los cuatro.
 *
 *   b) DOS NECESIDADES DEL MISMO SITIO, partidas en dos filas. "Teatro de
 *      garaje" pide elementos de construcción en una fila y alimentos en otra,
 *      pero las direcciones son "Carrera 10 # 54 A - 27" y "- 28": el mismo
 *      sitio con el número corrido en uno. Eso es el arrastre de
 *      autocompletado de Google Sheets, que incrementa el último número al
 *      halar la celda hacia abajo. Lo mismo en Galería Aborigen (-17 / -18) y
 *      en Tolima nos necesita (80-94 / 80-95). Pintarlos como dos puntos
 *      duplicaría el mismo sitio en el mapa.
 *
 * Lo que separa un caso del otro es la BASE de la dirección: todo menos el
 * número final. Si dos filas comparten base son el mismo sitio (misma vía y
 * mismo cruce, o sea la misma cuadra) y sus necesidades se juntan; si la base
 * difiere, son sedes distintas.
 *
 * ⚠️ Consecuencia aceptada: dos sedes reales en la misma cuadra quedarían
 * fusionadas. Es preferible a duplicar — sin coordenada propia las dos caen en
 * el mismo punto del municipio de todos modos — y las direcciones descartadas
 * viajan en `dv` para poder auditarlas.
 */
export function baseDireccion(d) {
  const s = norm(d).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Quita el número final y lo que lo separa ("- 27", "-94", " 34").
  const sinFinal = s.replace(/[\s\-–—]*\d+[a-z]?\s*$/, '').trim();
  return sinFinal || s;
}

/** Identidad de una sede: organización + municipio + cuadra. */
export const claveNec = (nombre, municipio, direccion) =>
  `${norm(nombre)}|${norm(municipio)}|${baseDireccion(direccion)}`;

/**
 * El sitio FÍSICO, para preguntarle a OpenStreetMap.
 *
 * Los nombres de esta hoja traen el lugar entre paréntesis —"Cruz roja
 * (Estadio el campín)", "Tolima nos necesita (Plazoleta externa titan plaza)"—
 * y ese paréntesis es justo lo que un mapa sabe encontrar; el nombre de la
 * organización, casi nunca. Sin esto, buscar "Fundación pacifico somos todos"
 * no devuelve nada, y buscar "Hotel click clack" sí.
 */
export function sitioDe(nombre) {
  const m = String(nombre || '').match(/\(([^)]{3,})\)\s*$/);
  return (m ? m[1] : nombre || '').trim();
}

/* ──────────────────────────────── columnas ──────────────────────────────── */

function indices(cab) {
  const ix = {};
  cab.forEach((h, i) => { ix[norm(h)] = i; });
  const buscar = (...nombres) => {
    for (const n of nombres) if (ix[n] !== undefined) return ix[n];
    return -1;
  };
  return {
    nombre:    buscar('nombre', 'organizacion', 'quien pide'),
    tipo:      buscar('tipo', 'tipo de organizacion'),
    necesidad: buscar('necesidad', 'necesidades', 'que necesita'),
    fecha:     buscar('fecha de la necesidad', 'fecha'),
    direccion: buscar('direccion'),
    municipio: buscar('municipio', 'ciudad o municipio', 'ciudad'),
    depto:     buscar('departamento', 'depto'),
    contacto:  buscar('contacto'),
    telefono:  buscar('telefono', 'tel'),
    // De dónde salió la necesidad (un Instagram, una nota). Se muestra para
    // que quien vaya a cargar un camión pueda verificar antes de salir.
    fuente:    buscar('fuente', 'fuente url', 'enlace'),
    /* ⚠️ Cuando la hoja trae coordenada, MANDA sobre el centro del municipio y
       el punto deja de ser aproximado. Se lee con el mismo `coordenada()` de
       acopios, que ya sabe de la trampa del punto como separador de miles:
       pegar 4.668272 en un libro con configuración regional distinta lo guarda
       como 4.668.272 y `Number()` da NaN, perdiendo la coordenada en silencio. */
    lat:       buscar('latitud', 'lat'),
    lon:       buscar('longitud', 'lon', 'lng'),
  };
}

/**
 * Fecha de la necesidad, solo si es creíble.
 *
 * ⚠️⚠️ La hoja trae fechas IMPOSIBLES —16/08/2028, 2029, 2030 y 2031— en las
 * cuatro filas de Chocopan. Es el mismo arrastre de autocompletado que corre
 * el número de la dirección: al halar la celda, Google incrementa el año. Una
 * ficha que diga "necesidad del 16 de agosto de 2031" se lee como un error de
 * la página y le quita credibilidad a todo lo demás.
 *
 * No se corrige inventando el año que "debería" ser: se descarta y la ficha
 * simplemente no muestra fecha. El conteo de descartes viaja en el JSON para
 * que se pueda arreglar en la hoja, que es donde se arregla de verdad.
 */
export function fechaDe(txt, ahora) {
  const s = String(txt || '').trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return '';
  const [, d, mes, a] = m.map(Number);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return '';
  const t = Date.UTC(a, mes - 1, d);
  const hoy = ahora ?? Date.now();
  // Mañana ya es futuro: una necesidad no se registra antes de tenerla.
  if (t > hoy + 36 * 3600 * 1000) return '';
  // Nada anterior al sismo: es otro error de digitación, no un dato viejo.
  if (t < Date.UTC(2026, 7, 1)) return '';
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const BBOX = { latMin: -4.3, latMax: 13.6, lonMin: -82.0, lonMax: -66.8 };

/**
 * Filas de la hoja → una entrada por SEDE, con sus necesidades juntas.
 */
export function normalizarFilas(filas, ahora) {
  if (!filas.length) return { items: [], sin_ubicar: 0, fechas_descartadas: 0 };
  const ix = indices(filas[0]);
  if (ix.nombre < 0) return { items: [], sin_ubicar: 0, error: 'sin_columna_nombre' };

  const g = (f, i) => (i >= 0 ? LIMPIO(f[i]) : '');
  const porClave = new Map();
  let fechasFuera = 0;

  for (let r = 1; r < filas.length; r++) {
    const f = filas[r];
    const nombre = g(f, ix.nombre);
    const necesidad = g(f, ix.necesidad);
    // Una fila sin nombre o sin necesidad no dice nada: la hoja arrastra
    // cientos de filas de relleno con solo un "FALSE" en la columna de tipo.
    if (!nombre || !necesidad) continue;

    const muni = g(f, ix.municipio);
    const dir = g(f, ix.direccion);
    const clave = claveNec(nombre, muni, dir);
    const cruda = g(f, ix.fecha);
    const fecha = fechaDe(cruda, ahora);
    if (cruda && !fecha) fechasFuera++;

    let it = porClave.get(clave);
    if (!it) {
      let dep = g(f, ix.depto);
      let la = coordenada(g(f, ix.lat), 'lat');
      let lo = coordenada(g(f, ix.lon), 'lon');
      let aprox = false;
      if (la == null || lo == null) {
        const c = CENTRO.get(norm(muni));
        if (c) { la = c[2]; lo = c[3]; aprox = true; if (!dep) dep = c[1]; }
        // Mismo respaldo que en acopios: la tabla de prensa solo trae 118.
        else {
          const t = centroDe(muni, dep);
          if (t) { la = t[1]; lo = t[2]; aprox = true; if (!dep) dep = t[0]; }
        }
      }

      it = {
        k: clave,
        n: nombre,
        // Tipo de ORGANIZACIÓN (ONG, colectivo, organismo de socorro), no tipo
        // de lugar: es lo que decide la forma del marcador.
        org: g(f, ix.tipo),
        mu: muni,
        dp: dep,
        d: dir,
        dv: [],            // otras direcciones de la misma cuadra (ver arriba)
        nes: [],           // una entrada por fila: la hoja parte un pedido largo
        f: fecha,
        c: g(f, ix.contacto),
        tel: g(f, ix.telefono),
        url: g(f, ix.fuente),
        la, lo,
        ap: aprox ? 1 : 0,
      };
      porClave.set(clave, it);
    }

    // Dedup por texto: la misma necesidad repetida en las 4 sedes de una
    // organización no tiene por qué aparecer cuatro veces en su ficha.
    if (!it.nes.some((x) => norm(x) === norm(necesidad))) it.nes.push(necesidad);
    if (dir && dir !== it.d && !it.dv.includes(dir)) it.dv.push(dir);
    // La fecha que manda es la más reciente que sea creíble.
    if (fecha && (!it.f || fecha > it.f)) it.f = fecha;
    if (!it.c) it.c = g(f, ix.contacto);
    if (!it.tel) it.tel = g(f, ix.telefono);
    if (!it.url) it.url = g(f, ix.fuente);
    // Si UNA de las filas de la sede trajo coordenada, la sede deja de ser
    // aproximada: la hoja se llena de a poquitos y basta con que una la tenga.
    if (it.ap) {
      const la2 = coordenada(g(f, ix.lat), 'lat');
      const lo2 = coordenada(g(f, ix.lon), 'lon');
      if (la2 != null && lo2 != null) { it.la = la2; it.lo = lo2; it.ap = 0; }
    }
  }

  const items = [...porClave.values()];
  let sinUbicar = 0;

  // Cuántas sedes tiene cada organización en el mismo municipio. Sin esto, ver
  // cuatro puntos con el mismo nombre parece un error de la página.
  const sedes = new Map();
  for (const it of items) {
    const g2 = `${norm(it.n)}|${norm(it.mu)}`;
    sedes.set(g2, (sedes.get(g2) || 0) + 1);
  }
  const vistos = new Map();
  for (const it of items) {
    const g2 = `${norm(it.n)}|${norm(it.mu)}`;
    const total = sedes.get(g2);
    if (total > 1) {
      const i = (vistos.get(g2) || 0) + 1;
      vistos.set(g2, i);
      it.sede = i; it.sedes = total;
    }
    it.ne = it.nes.join(' · ');       // texto plano, para búsqueda y filtros
    if (it.la != null && (it.la < BBOX.latMin || it.la > BBOX.latMax ||
                          it.lo < BBOX.lonMin || it.lo > BBOX.lonMax)) {
      it.la = null; it.lo = null;
    }
    if (it.la == null) sinUbicar++;
  }

  return { items, sin_ubicar: sinUbicar, fechas_descartadas: fechasFuera };
}

/* ────────────────────────── ubicación por nombre ────────────────────────── */

/**
 * Igual que en acopios: se busca el SITIO por nombre, nunca la dirección.
 *
 * ⚠️⚠️ Nominatim no interpreta el número de una dirección colombiana —está
 * medido en `acopios.js`, con errores de 5 a 19 km y pinta de precisión—. Acá
 * se aprovecha que el nombre trae el lugar entre paréntesis, que es lo que un
 * mapa sí sabe encontrar. Lo que no se resuelva queda en el centro del
 * municipio, declarado como aproximado, con la dirección literal a la mano.
 */
async function geocodificarPendientes(env, items, max) {
  let usados = 0;
  const cache = new Map();
  try {
    const r = await env.DB.prepare('SELECT clave, lat, lon, fuente FROM geocache').all();
    for (const f of r.results || []) cache.set(f.clave, f);
  } catch (e) {
    console.error('geocache ilegible', e && e.message);
  }

  for (const a of items) {
    if (!a.ap || !a.n) continue;
    /* ⚠️⚠️ Una organización con VARIAS SEDES no se geocodifica. La búsqueda es
       por nombre, así que las cuatro sedes de "Chocopan por una sonrisa"
       recibirían LA MISMA coordenada —la de la que OSM haya encontrado— y las
       otras tres quedarían con un pin preciso en la dirección equivocada. Sin
       forma de saber cuál es cuál, se quedan en el centro del municipio, que
       la ficha declara aproximado, con su dirección literal a la mano. */
    if (a.sedes > 1) continue;
    const sitio = sitioDe(a.n);
    const clave = `${norm(sitio)}|${norm(a.mu)}`;
    const fila = cache.get(clave);

    if (fila) {
      if (fila.lat != null) {
        a.la = fila.lat; a.lo = fila.lon; a.ap = 0; a.geo = fila.fuente || 'osm';
      }
      continue;
    }
    if (usados >= max) continue;
    usados++;

    const centro = CENTRO.get(norm(a.mu));
    let res = null;
    try {
      res = await geocodificarNombre(sitio, a.mu, centro ? [centro[2], centro[3]] : null);
    } catch (e) {
      console.error('geocode falló', sitio, e && e.message);
      continue;                       // sin cachear: se reintenta en la próxima
    }
    try {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO geocache (clave, lat, lon, fuente, ts) VALUES (?,?,?,?,?)'
      ).bind(clave, res ? res.la : null, res ? res.lo : null,
             res ? `osm:${res.tipo}` : null, Date.now()).run();
    } catch { /* si no se puede cachear, igual se usa */ }
    cache.set(clave, { clave, lat: res ? res.la : null, lon: res ? res.lo : null,
                       fuente: res ? `osm:${res.tipo}` : null });
    if (res) { a.la = res.la; a.lo = res.lo; a.ap = 0; a.geo = `osm:${res.tipo}`; }

    if (usados < max) await new Promise((r) => setTimeout(r, 1100));
  }
  return usados;
}

/* ──────────────────────────────── lectura ──────────────────────────────── */

export async function refrescar(env, opciones = {}) {
  const url = env.NECESIDADES_CSV;
  if (!url) return null;

  const r = await fetch(url, {
    headers: { 'User-Agent': 'MapaDeAyuda/1.0 (+https://reconstruyocolombia.com)' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`hoja http ${r.status}`);
  const txt = await r.text();
  if (/^\s*<(!doctype|html)/i.test(txt)) throw new Error('la hoja no es pública');

  const { items, sin_ubicar, fechas_descartadas, error } =
    normalizarFilas(parsearCSV(txt));
  if (error) throw new Error(error);

  let geocodificados = 0;
  try {
    geocodificados = await geocodificarPendientes(env, items, opciones.geocodificar || 0);
  } catch (e) {
    console.error('geocodificación de necesidades falló entera', e && e.message);
  }

  const datos = {
    generado: Date.now(),
    total: items.length,
    sin_ubicar,
    // Se publica para que se pueda arreglar EN LA HOJA: son fechas del futuro
    // que dejó el arrastre de autocompletado.
    fechas_descartadas,
    con_punto_propio: items.filter((i) => !i.ap && i.la != null).length,
    geocodificados_ahora: geocodificados,
    revisado: false,
    items,
  };
  await env.DB.prepare(
    `INSERT INTO externos (id, ts, datos) VALUES ('necesidades', ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, datos = excluded.datos`
  ).bind(datos.generado, JSON.stringify(datos)).run();
  return datos;
}

/**
 * Devuelve las necesidades, refrescando si la copia guardada ya envejeció.
 *
 * ⚠️ Misma regla que en acopios: si la hoja falla se sirve LA ÚLTIMA COPIA
 * BUENA. Una edición que la deje vacía no puede borrar el mapa.
 */
export async function leer(env, maxEdadMs = 300000) {
  let guardado = null;
  try {
    const row = await env.DB.prepare("SELECT datos FROM externos WHERE id = 'necesidades'").first();
    if (row?.datos) guardado = JSON.parse(row.datos);
  } catch { /* sigue en null */ }

  const viejo = !guardado || (Date.now() - guardado.generado) > maxEdadMs;
  if (!viejo) return guardado;

  try {
    const fresco = await refrescar(env);
    if (fresco) return fresco;
  } catch (e) {
    console.error('necesidades: no se pudo refrescar', e && e.message);
    if (guardado) return { ...guardado, degradado: true };
    return { generado: Date.now(), total: 0, items: [], revisado: false, error: true };
  }
  return guardado || { generado: Date.now(), total: 0, items: [], revisado: false };
}
