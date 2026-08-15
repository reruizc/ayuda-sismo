/**
 * Pulso de prensa del sismo — recolección y clasificación.
 *
 * ⚠️⚠️ LO QUE ESTO MIDE ES COBERTURA MEDIÁTICA, NO REALIDAD. La unidad es el
 * titular publicado. Que un municipio tenga 40 notas de "se pide ayuda" no
 * significa que se pidieron 40 ayudas: significa que hubo 40 titulares que lo
 * mencionan. Un municipio sin periodistas se ve idéntico a un municipio sin
 * necesidades. Toda la página está redactada para no confundir las dos cosas,
 * y el bloque `sin_cobertura` existe justamente para nombrar el punto ciego.
 *
 * Clasificación DETERMINISTA: diccionarios y reglas, sin modelo de lenguaje.
 * Cualquiera puede auditar por qué una nota cayó donde cayó. El modelo solo
 * redacta el párrafo de resumen, que va marcado como automático.
 */
import { MUNICIPIOS, MUNICIPIOS_EXCLUIDOS } from './municipios.js';

// 10-ago-2026, 7:34 a.m. hora de Colombia (UTC-5).
export const SISMO_TS = Date.UTC(2026, 7, 10, 12, 34, 0);

const GNEWS = 'https://news.google.com/rss/search';
const UA = 'Mozilla/5.0 (compatible; MapaDeAyuda/1.0; +https://sismo.ricardoruiz.co)';

/** Temas, alineados a las situaciones del mapa y no a una taxonomía de prensa. */
export const TEMAS = {
  ayuda:      { n: 'Ayuda y donaciones', q: 'ayudas donaciones damnificados',
    kw: ['ayuda', 'ayudas', 'donacion', 'donaciones', 'donar', 'mercados', 'viveres',
         'kits', 'auxilio', 'subsidio', 'humanitaria'] },
  rescate:    { n: 'Rescate y escombros', q: 'rescate escombros atrapados',
    kw: ['rescate', 'rescataron', 'rescatistas', 'escombros', 'atrapados', 'socorristas',
         'bomberos', 'remocion', 'derrumbe', 'colapso'] },
  personas:   { n: 'Desaparecidos', q: 'desaparecidos identificacion victimas',
    kw: ['desaparecido', 'desaparecidos', 'desaparecida', 'identificacion',
         'medicina legal', 'reencuentro', 'busqueda de personas'] },
  albergue:   { n: 'Albergues', q: 'albergues damnificados alojamiento',
    kw: ['albergue', 'albergues', 'alojamiento', 'carpas', 'refugio', 'damnificados',
         'sin techo', 'evacuados'] },
  salud:      { n: 'Salud y heridos', q: 'hospitales heridos salud',
    kw: ['hospital', 'hospitales', 'heridos', 'clinica', 'medicamentos', 'salud',
         'urgencias', 'eps', 'atencion medica'] },
  danos:      { n: 'Daños y edificaciones', q: 'danos edificios colapso estructural',
    kw: ['danos', 'dano', 'agrietad', 'inhabitable', 'estructural', 'edificacion',
         'edificios', 'viviendas afectadas', 'demolicion', 'evaluacion de danos'] },
  servicios:  { n: 'Servicios y vías', q: 'energia agua vias aeropuerto',
    kw: ['energia', 'electrico', 'acueducto', 'agua potable', 'vias', 'carretera',
         'aeropuerto', 'telefonia', 'internet', 'servicio publico', 'restablec'] },
  gestion:    { n: 'Gobierno y gestión', q: 'ungrd gobierno alcaldia gobernacion',
    kw: ['ungrd', 'gobierno', 'presidente', 'alcaldia', 'alcalde', 'gobernacion',
         'gobernador', 'calamidad', 'decreto', 'ministro', 'ministerio', 'congreso'] },
  seguridad:  { n: 'Seguridad y orden', q: 'saqueos robos toque de queda',
    kw: ['saqueo', 'saqueos', 'robo', 'robos', 'hurto', 'toque de queda', 'militares',
         'ejercito', 'policia', 'orden publico', 'seguridad'] },
};

/**
 * Tipos de discurso. Cinco y no seis: el eje que importa para este sitio es
 * la distancia entre lo que se promete y lo que se entrega.
 */
export const DISCURSO = {
  pide:    { n: 'Se pide', kw: ['piden', 'pide', 'solicitan', 'solicita', 'necesitan',
    'necesita', 'urge', 'urgente', 'claman', 'clamor', 'requieren', 'hace falta',
    'faltan', 'sin agua', 'sin luz', 'sin comida', 'no tienen', 'suplican'] },
  promete: { n: 'Se promete', kw: ['anuncio', 'anuncia', 'anunciaron', 'anunciara',
    'destinara', 'destino', 'entregara', 'dispondra', 'promete', 'prometio',
    'invertira', 'girara', 'aprobo', 'aprueba', 'decreto', 'decretaron', 'garantiza',
    'gestionara', 'construira'] },
  entrega: { n: 'Se entregó', kw: ['entrego', 'entregaron', 'entregados', 'llegaron',
    'llego la ayuda', 'distribuyeron', 'recibieron', 'instalaron', 'habilitaron',
    'restablecieron', 'restablecio', 'reabrio', 'rescataron', 'evacuaron', 'atendieron',
    'benefician', 'beneficiados'] },
  reclama: { n: 'Se reclama', kw: ['denuncian', 'denuncia', 'critican', 'critica',
    'reclaman', 'reclamo', 'protesta', 'protestan', 'quejas', 'se quejan', 'abandono',
    'no ha llegado', 'no han llegado', 'incumple', 'demora', 'retraso', 'olvidados',
    'nadie ha venido'] },
  duelo:   { n: 'Duelo y víctimas', kw: ['murieron', 'muertos', 'fallecidos',
    'fallecio', 'victimas fatales', 'luto', 'sepelio', 'funeral', 'cuerpos',
    'sin vida', 'balance de victimas', 'deceso'] },
};

// Medios regionales del eje afectado. Lo que no está acá cae a "nacional",
// que es el lado seguro: la mayoría de la prensa digital colombiana lo es.
const REGIONALES = new Set(['lapatria', 'eldiario', 'latarde', 'elpaiscomco', 'occidente',
  'cronicadelquindio', 'lacronicadelquindio', 'qhubo', 'extra', 'bluradio', 'caracolradio',
  'telecafe', 'telepacifico', 'chocosiete', 'elquindiano', 'risaraldahoy', 'eje21',
  'caldasnoticias', 'periodicoelquindiano', 'noticaldas', 'cali', 'pereira']);

/* ─────────────────────────── índices de búsqueda ─────────────────────────── */

// Se separan los nombres de una palabra (búsqueda por token, O(1)) de los
// compuestos (búsqueda por substring). Con 118 municipios × 1.500 titulares,
// correr 118 expresiones regulares por título revienta el CPU del Worker.
const MUN_1 = new Map();
const MUN_N = [];
for (const [clave, nombre, dep, , la, lo] of MUNICIPIOS) {
  if (clave.includes(' ')) MUN_N.push([clave, nombre, dep, la, lo]);
  else MUN_1.set(clave, [nombre, dep, la, lo]);
}
MUN_N.sort((a, b) => b[0].length - a[0].length);   // el más largo gana

export const normalizar = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();

/* ─────────────────────────── recolección ─────────────────────────── */

function consultas() {
  const out = [];
  for (const [k, t] of Object.entries(TEMAS)) {
    out.push({ id: `tema:${k}`, q: `terremoto Colombia ${t.q}` });
  }
  // Consultas por ciudad: sin ellas, los municipios pequeños solo aparecen si
  // se cuelan en una consulta temática nacional.
  for (const c of ['Cali', 'Pereira', 'Manizales', 'Armenia', 'Quibdó',
                   'San José del Palmar', 'Dosquebradas', 'Buenaventura']) {
    out.push({ id: `ciudad:${c}`, q: `terremoto ${c}` });
  }
  return out;
}

/** Parseo del RSS por expresiones regulares: en Workers no hay DOMParser. */
function parsearRSS(xml) {
  const items = [];
  const bloques = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of bloques) {
    const g = (re) => { const m = b.match(re); return m ? m[1] : ''; };
    const crudo = g(/<title>([\s\S]*?)<\/title>/);
    const medio = g(/<source[^>]*>([\s\S]*?)<\/source>/);
    const link = g(/<link>([\s\S]*?)<\/link>/);
    const fecha = g(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!crudo) continue;

    const titulo = desescapar(crudo);
    const m = desescapar(medio);
    // Google News agrega " - Medio" al final del título; con el tag <source>
    // aparte, ese sufijo es ruido que además ensucia el dedup.
    const limpio = m && titulo.endsWith(` - ${m}`)
      ? titulo.slice(0, -(m.length + 3)) : titulo;

    const ts = Date.parse(fecha);
    items.push({
      titulo: limpio.trim(),
      medio: m || 'sin medio',
      url: desescapar(link),
      ts: Number.isFinite(ts) ? ts : null,
    });
  }
  return items;
}

function desescapar(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '').trim();
}

async function traer(q) {
  const url = `${GNEWS}?q=${encodeURIComponent(q)}&hl=es-419&gl=CO&ceid=CO:es`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    const txt = await r.text();
    console.log('DIAG traer', q.slice(0, 24), 'http', r.status, 'bytes', txt.length,
      'ct', r.headers.get('content-type'), 'cuerpo', JSON.stringify(txt.slice(0, 200)));
    if (!r.ok) return [];
    return parsearRSS(txt);
  } catch (e) {
    console.log('DIAG traer', q.slice(0, 24), 'THREW', e && e.name, e && e.message);
    return [];
  }
}

/* ─────────────────────────── clasificación ─────────────────────────── */

function detectarMunicipio(norm, palabras) {
  for (const [clave, nombre, dep, la, lo] of MUN_N) {
    if (norm.includes(clave)) return [nombre, dep, la, lo];
  }
  for (const w of palabras) {
    const hit = MUN_1.get(w);
    if (hit) return hit;
  }
  return null;
}

function detectarPorDiccionario(norm, palabras, dicc) {
  const out = [];
  for (const [k, def] of Object.entries(dicc)) {
    const pega = def.kw.some((t) => (t.includes(' ') ? norm.includes(t) : palabras.has(t)));
    if (pega) out.push(k);
  }
  return out;
}

function esRegional(medio) {
  const c = normalizar(medio).replace(/\s/g, '');
  for (const r of REGIONALES) if (c.includes(r)) return true;
  return false;
}

export function clasificar(items) {
  const notas = [];
  for (const it of items) {
    const norm = normalizar(it.titulo);
    const palabras = new Set(norm.split(' '));
    notas.push({
      ...it,
      mun: detectarMunicipio(norm, palabras),
      temas: detectarPorDiccionario(norm, palabras, TEMAS),
      disc: detectarPorDiccionario(norm, palabras, DISCURSO),
      regional: esRegional(it.medio),
      dia: it.ts != null ? Math.floor((it.ts - SISMO_TS) / 86400000) : null,
    });
  }
  return notas;
}

/* ─────────────────────────── agregación ─────────────────────────── */

export function agregar(notas) {
  const medios = new Set();
  const disc = {}; for (const k of Object.keys(DISCURSO)) disc[k] = 0;
  const porTema = {};
  const porMun = new Map();
  const porDia = new Map();
  const ejemplos = {};

  for (const n of notas) {
    medios.add(n.medio);
    for (const d of n.disc) disc[d]++;
    for (const t of n.temas) {
      if (!porTema[t]) porTema[t] = { n: 0, medios: new Set() };
      porTema[t].n++;
      porTema[t].medios.add(n.medio);
      if (!ejemplos[t]) ejemplos[t] = [];
      if (ejemplos[t].length < 4 && n.url) {
        ejemplos[t].push({ t: n.titulo, m: n.medio, u: n.url, ts: n.ts });
      }
    }
    if (n.mun) {
      const [nombre, dep, la, lo] = n.mun;
      if (!porMun.has(nombre)) {
        porMun.set(nombre, {
          n: nombre, dep, la, lo,
          notas: 0, pide: 0, promete: 0, entrega: 0, reclama: 0,
          // Titulares de muestra para que el mapa pueda enseñarlos al pasar el
          // mouse. Se guardan pocos a propósito: el snapshot lo baja cada
          // visitante y no es un archivo de prensa, es una muestra.
          tit: [],
        });
      }
      const e = porMun.get(nombre);
      e.notas++;
      for (const d of n.disc) if (e[d] !== undefined) e[d]++;
      if (e.tit.length < 6 && n.url) {
        e.tit.push({ t: n.titulo, m: n.medio, u: n.url, ts: n.ts });
      }
    }
    if (n.dia != null && n.dia >= 0 && n.dia < 60) {
      porDia.set(n.dia, (porDia.get(n.dia) || 0) + 1);
    }
  }

  // Municipios de los departamentos golpeados que NO aparecen en un solo
  // titular. Es el punto ciego del método, y se publica en vez de esconderse.
  //
  // ⚠️ Solo los de la ZONA AFECTADA. Bogotá, Medellín o Bucaramanga están en
  // la lista para poder detectarlas en un titular, no porque las haya tocado
  // el sismo; contarlas como "municipio sin cobertura" infla el hallazgo
  // principal con ciudades que nunca fueron el punto.
  const conNotas = new Set([...porMun.keys()].map(normalizar));
  const vistosSin = new Set();
  const sinCobertura = [];
  for (const [, nombre, dep, afectado] of MUNICIPIOS) {
    if (!afectado) continue;
    const k = normalizar(nombre);
    if (conNotas.has(k) || vistosSin.has(k)) continue;
    vistosSin.add(k);
    sinCobertura.push({ n: nombre, dep });
  }

  const listaMun = [...porMun.values()].sort((a, b) => b.notas - a.notas);
  const listaTema = Object.entries(porTema)
    .map(([k, v]) => ({ k, n: v.n, medios: v.medios.size }))
    .sort((a, b) => b.n - a.n);

  const regional = notas.filter((n) => n.regional).length;

  return {
    generado: Date.now(),
    sismo: SISMO_TS,
    totales: {
      notas: notas.length,
      medios: medios.size,
      municipios_con_lectura: listaMun.length,
      // Municipios DISTINTOS de la zona afectada, no llaves de búsqueda: varios
      // tienen dos formas de nombre ("Bahía Solano" y "Mutis") y contar llaves
      // inflaba el denominador que la página anuncia como "los que vigilamos".
      municipios_vigilados: new Set(
        MUNICIPIOS.filter((m) => m[3]).map((m) => m[1])).size,
      llaves_de_busqueda: MUN_1.size + MUN_N.length,
      sin_fecha: notas.filter((n) => n.ts == null).length,
      // ⚠️ Con SOLO EL TITULAR, la mayoría de las notas no revela si se pide,
      // se promete o se entrega: medido, alrededor de 4 de cada 5 quedan sin
      // clasificar. Publicar los conteos de intención sin este denominador
      // haría creer que describen todo el corpus. Va a la vista, no al pie.
      sin_intencion: notas.filter((n) => n.disc.length === 0).length,
      sin_municipio: notas.filter((n) => !n.mun).length,
    },
    discurso: disc,
    temas: listaTema,
    municipios: listaMun.slice(0, 40),
    sin_cobertura: sinCobertura.slice(0, 60),
    n_sin_cobertura: sinCobertura.length,
    // De la zona afectada. `municipios_con_lectura` cuenta también las ciudades
    // de fuera que se vigilan solo para detectarlas, así que no son la misma
    // cifra y la página no debe presentarlas como si sumaran.
    afectados_con_lectura:
      new Set(MUNICIPIOS.filter((m) => m[3]).map((m) => m[1])).size - sinCobertura.length,
    por_dia: [...porDia.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ d, n })),
    medios_alcance: { regional, nacional: notas.length - regional },
    ejemplos,
    metodo: {
      clasificacion: 'determinista',
      fuente: 'Google News RSS (es-419 · Colombia)',
      consultas: consultas().length,
      municipios_excluidos: MUNICIPIOS_EXCLUIDOS.length,
      excluidos_ejemplo: MUNICIPIOS_EXCLUIDOS.slice(0, 10),
    },
  };
}

/* ─────────────────────────── cifras del balance ─────────────────────────── */

/**
 * Extrae el balance de víctimas del propio corpus de prensa.
 *
 * ⚠️⚠️ ESTO NO ES "LA CIFRA OFICIAL DE LA UNGRD". Es lo que la prensa reporta
 * citando el balance oficial, y no es lo mismo. La UNGRD **no publica un feed**:
 * su conjunto en datos.gov.co (wwkg-r6te) tiene el esquema exacto que haría
 * falta —fallecidos, heridos, desaparecidos, viviendas— pero su último registro
 * es del 31-dic-2022. Por eso se lee de la prensa y se rotula así.
 *
 * Se publica SIEMPRE con el medio, el enlace y la hora, y con el rango cuando
 * las fuentes no coinciden. Esa discrepancia es información, no un defecto que
 * haya que promediar: en estos días conviven 239, 284, 285 y 287 fallecidos
 * según el corte de cada nota.
 */
// El número y su sustantivo, pegados. `\d{1,3}(?:\.\d{3})+` primero para que
// "3.975" se lea entero y no como "3" seguido de "975".
const CANT = String.raw`(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+|\d{2,6})\s+(?:personas\s+)?`;
const rx = (nucleo) => new RegExp(CANT + nucleo, 'g');

const CIFRAS = {
  fallecidos:   { n: 'Fallecidos',           rx: rx(String.raw`(?:fallecid\w*|muert\w*)`),   max: 20000 },
  desaparecidos:{ n: 'Desaparecidos',        rx: rx(String.raw`desaparecid\w*`),             max: 20000 },
  heridos:      { n: 'Heridos',              rx: rx(String.raw`herid\w*`),                   max: 100000 },
  destruidas:   { n: 'Viviendas destruidas', rx: rx(String.raw`viviendas?\s+(?:destruid\w*|colapsad\w*)`), max: 500000 },
  averiadas:    { n: 'Viviendas averiadas',  rx: rx(String.raw`viviendas?\s+(?:averiad\w*|afectad\w*|danad\w*)`), max: 900000 },
};

// "13.077" y "1,200" son miles; "7,4" es un decimal (la magnitud) y NO es una
// cifra de víctimas. Se exige el patrón de miles de 3 dígitos.
const NUM = /(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+|\d{2,6})/g;

/**
 * Normalización PROPIA del extractor de cifras: minúsculas y sin tildes, pero
 * CONSERVANDO la puntuación.
 *
 * ⚠️⚠️ No se puede reusar `normalizar()`: esa convierte todo signo en espacio y
 * parte el separador de miles. "12.584 viviendas destruidas" queda como
 * "12 584 viviendas destruidas", y el extractor publicaría **584 viviendas
 * destruidas** en vez de 12.584. Un cero de diferencia en una cifra de
 * damnificados es exactamente el error que no se puede cometer.
 */
const normalizarNum = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim();

/**
 * ⚠️⚠️ Dos reglas, y las dos salieron de ver el extractor equivocarse feo.
 *
 * 1. EL SUSTANTIVO VA PEGADO AL NÚMERO. La primera versión aceptaba el
 *    sustantivo "cerca" (34 caracteres) y en un titular como "Van 287 muertos,
 *    3.975 heridos y 378 desaparecidos" todos los números quedan cerca de todos
 *    los sustantivos: reportó 975 desaparecidos, sacados de "3.975 heridos".
 *
 * 2. MANDA LA CIFRA MÁS CORROBORADA, NO LA MÁS RECIENTE. Con "más reciente"
 *    publicó 10 fallecidos, que era el conteo local de Buenaventura, mientras
 *    veinte medios decían 287. Se exige que al menos DOS medios distintos
 *    sostengan el mismo número; si ninguno llega a dos, no se publica nada.
 *    Preferimos un hueco a un balance de víctimas equivocado.
 */
function extraerCifras(notas) {
  const cand = {};
  for (const k of Object.keys(CIFRAS)) cand[k] = [];

  for (const n of notas) {
    if (n.ts == null) continue;                  // sin fecha no hay corte
    const t = normalizarNum(n.titulo);
    for (const [k, def] of Object.entries(CIFRAS)) {
      def.rx.lastIndex = 0;
      let m;
      while ((m = def.rx.exec(t)) !== null) {
        const v = Number(m[1].replace(/[.,]/g, ''));
        if (!Number.isFinite(v) || v < 2 || v > def.max) continue;
        cand[k].push({ v, ts: n.ts, medio: n.medio, url: n.url, tit: n.titulo });
      }
    }
  }

  const out = {};
  for (const [k, def] of Object.entries(CIFRAS)) {
    const lista = cand[k];
    if (!lista.length) continue;

    // Ventana de 24 h desde la nota más reciente: una cifra de hace tres días
    // ya no la sostiene nadie y solo ensancharía el rango.
    const ultimo = Math.max(...lista.map((x) => x.ts));
    const ventana = lista.filter((x) => ultimo - x.ts < 86400000);

    // Se agrupa por valor y se cuentan MEDIOS DISTINTOS, no notas: un mismo
    // medio republicando su nota no corrobora nada.
    const porValor = new Map();
    for (const x of ventana) {
      if (!porValor.has(x.v)) porValor.set(x.v, { medios: new Set(), ej: x, ts: x.ts });
      const g = porValor.get(x.v);
      g.medios.add(x.medio);
      if (x.ts > g.ts) { g.ts = x.ts; g.ej = x; }
    }

    const ranking = [...porValor.entries()]
      .map(([v, g]) => ({ v, n: g.medios.size, ts: g.ts, ej: g.ej }))
      .sort((a, b) => (b.n - a.n) || (b.ts - a.ts));

    const mejor = ranking[0];
    if (!mejor || mejor.n < 2) continue;         // sin corroborar, no se publica

    out[k] = {
      etiqueta: def.n,
      valor: mejor.v,
      medios_que_lo_sostienen: mejor.n,
      ts: mejor.ts,
      medio: mejor.ej.medio,
      url: mejor.ej.url,
      titular: mejor.ej.tit,
      // Otros valores que circulan con al menos dos medios detrás. Es
      // información, no ruido: dice cuánto se mueve el balance.
      alternativas: ranking.slice(1).filter((r) => r.n >= 2)
        .slice(0, 3).map((r) => ({ v: r.v, n: r.n })),
    };
  }
  return out;
}

/* ─────────────────────────── lectura automática ─────────────────────────── */

const PROMPT = `Eres analista de datos de una plataforma ciudadana colombiana tras el
terremoto del 10 de agosto de 2026. Te doy AGREGADOS de cobertura de prensa.

Escribe UN SOLO párrafo de 55 a 80 palabras, en tuteo neutro de Bogotá, que le diga a
un lector no experto qué muestra el conteo de esta corrida.

Reglas duras:
- Estás describiendo COBERTURA DE PRENSA, no la realidad del terreno. Nunca digas que
  algo "ocurrió" o "se necesita"; di que "se habla de", "se menciona", "la prensa reporta".
- Usa solo las cifras que te doy. No inventes ninguna.
- Si hay municipios sin una sola nota, menciónalo: es el hallazgo más importante.
- Nada de adjetivos dramáticos ni de llamados a la acción. Descriptivo y seco.
- No uses vocativos ni empieces con "En resumen".
Devuelve solo el párrafo, sin comillas ni encabezado.`;

export async function lecturaAutomatica(env, ag) {
  if (!env.DEEPSEEK_API_KEY) return null;
  const resumen = {
    notas: ag.totales.notas,
    medios: ag.totales.medios,
    municipios_con_notas: ag.totales.municipios_con_lectura,
    municipios_vigilados: ag.totales.municipios_vigilados,
    municipios_sin_una_sola_nota: ag.n_sin_cobertura,
    discurso: ag.discurso,
    temas_top: ag.temas.slice(0, 4),
    municipios_top: ag.municipios.slice(0, 5).map((m) => ({ n: m.n, notas: m.notas })),
    notas_por_dia: ag.por_dia,
  };
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: JSON.stringify(resumen) },
        ],
        // V4 gasta presupuesto en razonamiento y con un techo bajo devuelve
        // `content` vacío con finish_reason=length. Mismo gotcha que el resto
        // del proyecto: no bajar de 6000.
        max_tokens: 6000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(28000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const txt = (d.choices?.[0]?.message?.content || '').trim();
    return txt ? txt.replace(/^["“]|["”]$/g, '') : null;
  } catch {
    return null;   // la página se publica igual, sin el párrafo
  }
}

/* ─────────────────────────── orquestación ─────────────────────────── */

export async function recolectar(env) {
  const qs = consultas();
  const lotes = await Promise.all(qs.map((c) => traer(c.q).catch(() => [])));

  // Dedup por (titular normalizado, medio): la misma nota llega por varias
  // consultas, y contarla dos veces inflaría todos los agregados.
  const vistos = new Set();
  const items = [];
  for (const lote of lotes) {
    for (const it of lote) {
      const llave = `${normalizar(it.titulo).slice(0, 90)}::${normalizar(it.medio)}`;
      if (vistos.has(llave)) continue;
      vistos.add(llave);
      items.push(it);
    }
  }

  const notas = clasificar(items);
  const ag = agregar(notas);
  ag.cifras = extraerCifras(notas);
  ag.lectura = await lecturaAutomatica(env, ag);
  ag.lectura_automatica = true;

  await env.DB.prepare(
    `INSERT INTO inteligencia (id, ts, datos) VALUES ('actual', ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, datos = excluded.datos`
  ).bind(ag.generado, JSON.stringify(ag)).run();

  return ag;
}

export async function leer(env) {
  const r = await env.DB.prepare("SELECT datos FROM inteligencia WHERE id = 'actual'").first();
  if (!r?.datos) return null;
  try { return JSON.parse(r.datos); } catch { return null; }
}
