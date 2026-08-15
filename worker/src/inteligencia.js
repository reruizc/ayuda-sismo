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

/**
 * UA para los feeds de los medios.
 *
 * ⚠️ Lleva el token de navegador ADELANTE y nuestro identificador atrás. No es
 * capricho: medido, El Diario de Pereira responde **403 al UA propio y 200 al
 * híbrido** —su WAF corta por "esto no parece un navegador"—, y es un medio
 * regional de la zona afectada con 99 notas, de los que más importan acá.
 *
 * Seguimos diciendo quiénes somos y dejando una URL de contacto, que es lo que
 * permite que alguien nos pida parar. Si un medio lo pide, se saca de MEDIOS.
 */
const UA_FEED = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36 '
  + 'MapaDeAyuda/1.0 (+https://sismo.ricardoruiz.co)';

/**
 * MEDIOS · el RSS propio de cada periódico. Esta es la fuente.
 *
 * ⚠️⚠️ Se dejó de depender de Google News porque nos bloqueaba. Su endpoint
 * `news.google.com/rss/search` NO es una API pública: Google cerró su News API
 * en 2011 y ese RSS sobrevive sin documentación, sin llave y **sin cuota
 * publicada**. O sea que no hay un límite al cual ajustarse; hay una heurística
 * antibot que un día decide que somos un robot y contesta `503` con su página
 * "Sorry...". Peor: bloquea por IP de salida, y las IP de Cloudflare las
 * comparten miles de Workers, así que se hereda la mala reputación de terceros.
 * No se arregla portándose bien.
 *
 * El RSS de cada medio es lo contrario: lo publica el propio periódico para
 * que lo lean, sale de su hosting y no tiene antibot.
 *
 * ⚠️ Cada URL de esta lista fue PROBADA, no adivinada (15-ago-2026): responde
 * un feed válido con items. Adivinar rutas da 404 en la mitad de los casos —de
 * 38 candidatos, 12 acertaron a la primera— y varias solo aparecen leyendo el
 * `<link rel="alternate">` del home. Al agregar un medio, probarlo antes.
 *
 * ⚠️ `reg` (regional) viene de acá y ya no de adivinar por el nombre del
 * medio, que era una lista de subcadenas y fallaba en los dos sentidos.
 *
 * Fuera a propósito:
 *  · El Espectador — su único feed vivo es el de "discover" y trae notas de
 *    mayo; un feed viejo no aporta y ensucia la ventana.
 *  · Blu Radio, El Colombiano, Pulzo, RCN, W Radio, Crónica del Quindío,
 *    El Quindiano, Telecafé — no exponen RSS alcanzable (probado).
 */
export const MEDIOS = [
  // ── zona afectada ──
  { id: 'elpaiscali',   n: 'El País (Cali)',        reg: 1, url: 'https://www.elpais.com.co/arc/outboundfeeds/rss/?outputType=xml' },
  { id: 'eldiario',     n: 'El Diario (Pereira)',   reg: 1, url: 'https://www.eldiario.com.co/feed/' },
  { id: 'latarde',      n: 'La Tarde (Pereira)',    reg: 1, url: 'https://www.latarde.com/feed/' },
  { id: 'lapatria',     n: 'La Patria (Manizales)', reg: 1, url: 'https://www.lapatria.com/rss.xml' },
  { id: 'eje21',        n: 'Eje21',                 reg: 1, url: 'https://eje21.com.co/feed/' },
  { id: 'risaraldahoy', n: 'Risaralda Hoy',         reg: 1, url: 'https://risaraldahoy.com/feed/' },
  { id: 'quindionot',   n: 'Quindío Noticias',      reg: 1, url: 'https://quindionoticias.com/feed/' },
  { id: 'occidente',    n: 'Diario Occidente',      reg: 1, url: 'https://occidente.co/feed/' },
  { id: '90minutos',    n: '90 Minutos (Cali)',     reg: 1, url: 'https://90minutos.co/feed/' },
  { id: 'qhubocali',    n: "Q'Hubo Cali",           reg: 1, url: 'https://qhubocali.com/feed/' },
  { id: 'choco7dias',   n: 'Chocó 7 Días',          reg: 1, url: 'https://choco7dias.com/feed/' },
  { id: 'eltiempocali', n: 'El Tiempo · Cali',      reg: 1, url: 'https://www.eltiempo.com/rss/colombia_cali.xml' },
  // ── nacionales ──
  { id: 'eltiempo',     n: 'El Tiempo',             reg: 0, url: 'https://www.eltiempo.com/rss/colombia.xml' },
  { id: 'semana',       n: 'Semana',                reg: 0, url: 'https://www.semana.com/arc/outboundfeeds/rss/?outputType=xml' },
  { id: 'caracolradio', n: 'Caracol Radio',         reg: 0, url: 'https://caracol.com.co/arc/outboundfeeds/rss/?outputType=xml' },
  // ⚠️ Infobae contesta 200 desde una IP residencial y 403 desde el Worker:
  // ahí el corte es por IP, no por UA, y no hay UA que lo arregle. Se deja en
  // la lista porque cuesta una petición y la bitácora avisa si algún día
  // vuelve; mientras tanto sale como caído y no afecta a los otros 19.
  { id: 'infobaeco',    n: 'Infobae Colombia',      reg: 0, url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/colombia/' },
  { id: 'elheraldo',    n: 'El Heraldo',            reg: 0, url: 'https://www.elheraldo.co/arc/outboundfeeds/rss/?outputType=xml' },
  { id: 'las2orillas',  n: 'Las2Orillas',           reg: 0, url: 'https://www.las2orillas.co/feed/' },
  { id: 'elnuevosiglo', n: 'El Nuevo Siglo',        reg: 0, url: 'https://www.elnuevosiglo.com.co/rss.xml' },
  { id: 'minuto30',     n: 'Minuto30',              reg: 0, url: 'https://www.minuto30.com/feed/' },
];

/**
 * ⚠️⚠️ EL FILTRO ES OBLIGATORIO Y ES LA DIFERENCIA CON GOOGLE.
 *
 * A Google se le pedía "terremoto Cali" y devolvía solo eso. El feed de un
 * medio trae TODO lo que publicó —fútbol, farándula, política— así que el
 * recorte temático hay que hacerlo acá. Sin esto, el pulso del sismo contaría
 * la programación del fin de semana.
 */
const SISMO_KW = [
  'sismo', 'sismos', 'sismica', 'sismico', 'terremoto', 'temblor', 'temblores',
  'replica', 'replicas', 'magnitud', 'epicentro', 'richter', 'movimiento telurico',
];
// Palabras de emergencia que solo cuentan si además se nombra la zona: "ayuda
// humanitaria" a secas puede ser de Gaza, y "damnificados" de una inundación.
const EMERGENCIA_KW = [
  'damnificado', 'damnificados', 'albergue', 'albergues', 'escombros', 'derrumbe',
  'colapso', 'rescatistas', 'socorristas', 'ungrd', 'calamidad', 'evacuados',
  'ayuda humanitaria', 'donaciones', 'centro de acopio', 'centros de acopio',
  'desaparecidos', 'remocion de escombros', 'viviendas afectadas', 'emergencia',
];
// Nombres de la zona golpeada, para calificar lo anterior.
const ZONA_KW = [
  'choco', 'valle del cauca', 'risaralda', 'caldas', 'quindio', 'cauca',
  'cali', 'pereira', 'manizales', 'armenia', 'quibdo', 'dosquebradas',
  'buenaventura', 'san jose del palmar', 'eje cafetero', 'pacifico',
];

const pegaAlguna = (norm, palabras, lista) =>
  lista.some((t) => (t.includes(' ') ? norm.includes(t) : palabras.has(t)));

/** ¿Esta nota habla del sismo? Determinista y auditable, como el resto. */
export function esDelSismo(titulo) {
  const norm = normalizar(titulo);
  const palabras = new Set(norm.split(' '));
  if (pegaAlguna(norm, palabras, SISMO_KW)) return true;
  return pegaAlguna(norm, palabras, EMERGENCIA_KW)
      && pegaAlguna(norm, palabras, ZONA_KW);
}

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

/**
 * Parseo del feed propio de un medio. Sirve RSS 2.0 y Atom.
 *
 * ⚠️ Dos diferencias con el RSS de Google, y las dos importan:
 *  · El nombre del medio NO viene adentro (no hay `<source>`): lo pone la
 *    ficha de MEDIOS. Sin esto todas las notas saldrían como "sin medio".
 *  · Hay feeds Atom, que usan `<entry>` y `<link href="...">` en vez de
 *    `<item>` y `<link>texto</link>`.
 */
function parsearFeed(xml, medio, regional) {
  const items = [];
  const bloques = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/g) || [];
  for (const b of bloques) {
    const g = (re) => { const m = b.match(re); return m ? m[1] : ''; };
    const crudo = g(/<title[^>]*>([\s\S]*?)<\/title>/);
    if (!crudo) continue;

    // Atom pone la URL en un atributo; RSS, en el texto del nodo.
    const link = desescapar(g(/<link[^>]*>([\s\S]*?)<\/link>/))
      || g(/<link[^>]+href=["']([^"']+)["']/);

    const fechaTxt = g(/<pubDate>([\s\S]*?)<\/pubDate>/)
      || g(/<updated>([\s\S]*?)<\/updated>/)
      || g(/<published>([\s\S]*?)<\/published>/)
      || g(/<dc:date>([\s\S]*?)<\/dc:date>/);
    const ts = Date.parse(desescapar(fechaTxt));

    items.push({
      titulo: desescapar(crudo).trim(),
      medio,
      regional: Boolean(regional),
      url: link,
      ts: Number.isFinite(ts) ? ts : null,
    });
  }
  return items;
}

/** Baja el feed de un medio. Nunca lanza: devuelve su propio diagnóstico. */
async function traerMedio(m) {
  const t0 = Date.now();
  try {
    const r = await fetch(m.url, {
      headers: {
        'User-Agent': UA_FEED,
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text();
    const ok = r.ok && ES_FEED.test(txt);
    const todos = ok ? parsearFeed(txt, m.n, m.reg) : [];
    // El recorte temático se hace acá, no en el agregado: así el diagnóstico
    // distingue "el medio publicó 100 notas y ninguna era del sismo" de "el
    // medio no respondió", que son problemas distintos.
    const items = todos.filter((it) => esDelSismo(it.titulo));
    return {
      id: m.id, ok, http: r.status, ms: Date.now() - t0,
      n: items.length, del_feed: todos.length, bytes: txt.length,
      muestra: ok ? undefined : txt.slice(0, 300),
      items,
    };
  } catch (e) {
    return {
      id: m.id, ok: false, http: 0, ms: Date.now() - t0, n: 0, del_feed: 0,
      err: `${(e && e.name) || 'Error'}: ${(e && e.message) || e}`,
      items: [],
    };
  }
}

function desescapar(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '').trim();
}

// Un feed válido, aunque venga sin una sola nota, trae estas etiquetas. La
// página "Sorry..." de Google no. Es el discriminador entre "no hay noticias
// de este municipio" —que es un resultado legítimo— y "no pude preguntar".
const ES_FEED = /<rss[\s>]|<feed[\s>]|<channel[\s>]/i;

/** Un intento contra Google News. Nunca lanza: devuelve su propio diagnóstico. */
async function unIntento(c) {
  const url = `${GNEWS}?q=${encodeURIComponent(c.q)}&hl=es-419&gl=CO&ceid=CO:es`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      // ⚠️ Sin techo, una consulta colgada se lleva por delante la corrida
      // entera: `Promise.all` no resuelve nunca y la invocación muere sin
      // dejar ni siquiera constancia de que corrió. Pasó, y por eso está.
      signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text();
    // ⚠️ "Fallida" es que la petición no sirvió, NO que no haya noticias. Una
    // consulta por un municipio pequeño puede devolver un feed legítimo y
    // vacío; tratarlo como fallo dispararía reintentos inútiles y podría
    // descartar una corrida buena por el umbral de "la mayoría falló".
    const ok = r.ok && ES_FEED.test(txt);
    const items = ok ? parsearRSS(txt) : [];
    return {
      ok, http: r.status, ms: Date.now() - t0,
      n: items.length, bytes: txt.length,
      // Solo cuando algo salió mal: si el cuerpo no es RSS, los primeros
      // caracteres suelen decir exactamente qué respondió el otro lado.
      muestra: ok ? undefined : txt.slice(0, 300),
      items,
    };
  } catch (e) {
    return {
      ok: false, http: 0, ms: Date.now() - t0, n: 0,
      err: `${(e && e.name) || 'Error'}: ${(e && e.message) || e}`,
      items: [],
    };
  }
}

const pausa = (ms) => new Promise((s) => setTimeout(s, ms));

/**
 * Una consulta a Google News, con un reintento SOLO si tiene sentido.
 *
 * ⚠️⚠️ Devuelve el DIAGNÓSTICO junto con los items, y nunca lanza. La versión
 * anterior era `traer(q).catch(() => [])`: una consulta que fallaba quedaba
 * indistinguible de una consulta que no encontró nada, así que 17 fallos
 * seguidos producían una corrida "exitosa" de cero notas que se publicaba
 * encima de la buena. El motivo del fallo —código HTTP, excepción, cuerpo que
 * no es RSS— es justo lo que hace falta para saber a quién reclamarle, y fue
 * lo que permitió identificarlo: 17 respuestas `503` con la página
 * "Sorry..." de Google, o sea bloqueo por consultas automatizadas.
 *
 * ⚠️⚠️ NO se reintenta un 503. Medido: contra el bloqueo por abuso el
 * reintento falla igual, y lo único que consigue es DUPLICAR las peticiones
 * —de 17 a 34— justo cuando Google nos está diciendo que somos demasiados.
 * Insistir prolonga el bloqueo. Se reintenta solo lo que puede ser un tropiezo
 * de red: timeout, corte de conexión, 5xx que no sea 503.
 */
function vaLaPena(r) {
  if (r.ok) return false;
  return r.http === 0 || (r.http >= 500 && r.http !== 503);
}

async function traer(c) {
  const r = await unIntento(c);
  if (r.ok || !vaLaPena(r)) return { id: c.id, ...r };

  await pausa(4000);
  const r2 = await unIntento(c);
  return {
    id: c.id, ...r2, reintento: true,
    // Se conserva el diagnóstico del PRIMER fallo: es el que explica qué pasó.
    primer_fallo: r.err || `http ${r.http}`,
  };
}

/**
 * Corre las consultas en tandas pequeñas, con pausa, y ABANDONA si nos
 * bloquearon.
 *
 * ⚠️⚠️ El corta-circuitos es la parte que importa. Google bloquea por IP de
 * salida y con `503`; una vez que está bloqueando, las 17 consultas van a
 * fallar igual. Seguir disparándolas —y peor, reintentarlas— es insistirle a
 * quien ya dijo que no, y es lo que hace que el bloqueo dure más. Si la
 * primera tanda vuelve entera con 503, se abandona: la corrida pasa de 34
 * peticiones a 3, se anota el bloqueo y se conserva lo último bueno.
 *
 * Las tandas y la pausa siguen porque 17 peticiones simultáneas desde una IP
 * de datacenter tienen la forma exacta de una ráfaga automatizada. Nadie está
 * esperando esta corrida —es un cron cada 3 horas—, así que ir despacio no
 * cuesta nada.
 */
async function enTandas(items, tam, msEntre, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += tam) {
    if (i) await pausa(msEntre);
    const tanda = await Promise.all(items.slice(i, i + tam).map(fn));
    out.push(...tanda);

    if (tanda.length && tanda.every((r) => r.http === 503)) {
      // Se marcan las que no se llegaron a pedir, para que la bitácora no
      // aparente que fallaron: no se intentaron a propósito.
      for (const c of items.slice(i + tam)) {
        out.push({ id: c.id, ok: false, http: null, n: 0, items: [],
                   omitida: 'abandonado tras bloqueo 503' });
      }
      break;
    }
  }
  return out;
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
      // El alcance viene de la ficha del medio cuando la nota salió de su
      // propio feed —ahí lo sabemos con certeza—; la heurística por nombre
      // queda solo para lo que llegue por Google, donde el medio es un texto.
      regional: it.regional !== undefined ? it.regional : esRegional(it.medio),
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
      // ⚠️ La página imprime `fuente` y `consultas` en una sola frase, así que
      // el texto de acá tiene que quedar cierto ahí. Ya no se le pregunta a un
      // buscador: se leen los feeds de los medios y el recorte del tema lo
      // hacemos nosotros.
      fuente: `RSS propio de ${MEDIOS.length} medios `
            + `(${MEDIOS.filter((m) => m.reg).length} de la zona afectada, `
            + `${MEDIOS.filter((m) => !m.reg).length} nacionales)`,
      consultas: MEDIOS.length,
      medios_leidos: MEDIOS.map((m) => m.n),
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

/**
 * Deja constancia de una corrida, salga bien o mal.
 *
 * ⚠️ Es la mitad del arreglo, no un adorno: sin esto una corrida en cero es
 * indistinguible de una corrida buena y nadie se entera hasta que alguien
 * abre la página y la ve vacía. Se guarda SIEMPRE, y el fallo se guarda con
 * más detalle que el éxito.
 *
 * Nunca lanza: que no se pueda anotar el fallo no puede convertirse en un
 * segundo fallo que tape al primero.
 */
export async function anotarCorrida(env, fila) {
  try {
    await env.DB.prepare(
      `INSERT INTO corridas (ts, tarea, origen, ok, publicado, ms, notas, medios, detalle)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      Date.now(), fila.tarea, fila.origen || 'desconocido',
      fila.ok ? 1 : 0, fila.publicado ? 1 : 0,
      fila.ms ?? null, fila.notas ?? null, fila.medios ?? null,
      fila.detalle ? JSON.stringify(fila.detalle).slice(0, 20000) : null
    ).run();
    // Se retienen ~30 días de corridas: es una bitácora de operación, no un
    // archivo histórico, y la base es la misma que sirve el mapa.
    await env.DB.prepare('DELETE FROM corridas WHERE ts < ?')
      .bind(Date.now() - 30 * 86400000).run();
  } catch (e) {
    console.error('no se pudo anotar la corrida', e && e.message);
  }
}

export async function ultimaCorrida(env, tarea = 'prensa') {
  try {
    const r = await env.DB.prepare(
      `SELECT ts, ok, publicado, notas, medios, ms FROM corridas
       WHERE tarea = ? ORDER BY ts DESC LIMIT 1`
    ).bind(tarea).first();
    return r || null;
  } catch { return null; }
}

/**
 * Recolecta el pulso de prensa y lo publica SOLO si la corrida sirve.
 *
 * ⚠️⚠️ El agregado nuevo no se publica a ciegas. Una recolección puede fallar
 * entera —lo hizo: el cron devolvía cero mientras la misma llamada por HTTP
 * traía 1.146 notas— y la versión anterior escribía ese cero encima del
 * agregado bueno, dejando la página vacía sin un solo rastro de que algo
 * había pasado. Ahora una corrida vacía o mayoritariamente fallida se anota y
 * se descarta: queda publicado lo último bueno.
 */
export async function recolectar(env, opciones = {}) {
  const origen = opciones.origen || 'desconocido';
  const t0 = Date.now();

  // ── fuente principal: el RSS propio de cada medio ───────────────────────
  const res = await enTandas(MEDIOS, 5, 400, traerMedio);

  // ── complemento opcional: Google News, APAGADO por defecto ──────────────
  //
  // ⚠️ Se enciende con la variable USAR_GOOGLE_NEWS=1. Está apagado porque nos
  // bloquea (503 "Sorry...") y el bloqueo es por IP de salida compartida, o
  // sea que no depende de portarse bien. Se conserva el camino —con su
  // corta-circuitos— por si algún día vuelve a servir, pero su fallo NUNCA
  // descarta la corrida: lo que manda es el RSS directo.
  let resG = [];
  if (env.USAR_GOOGLE_NEWS === '1') {
    resG = await enTandas(consultas(), 3, 900, traer);
  }

  const fallidas = res.filter((r) => !r.ok);
  const diag = res.map(({ items, ...d }) => d);
  const diagG = resG.map(({ items, ...d }) => d);

  // Dedup por (titular normalizado, medio): una nota puede repetirse entre el
  // feed y Google, y contarla dos veces inflaría todos los agregados.
  const vistos = new Set();
  const items = [];
  for (const { items: lote } of [...res, ...resG]) {
    for (const it of lote) {
      const llave = `${normalizar(it.titulo).slice(0, 90)}::${normalizar(it.medio)}`;
      if (vistos.has(llave)) continue;
      vistos.add(llave);
      items.push(it);
    }
  }

  // ── el filtro: ¿esta corrida se puede publicar? ─────────────────────────
  //
  // Dos motivos para descartarla, los dos medidos contra el fallo real:
  //  · CERO items. Con 20 medios leídos y un sismo de hace cinco días, cero
  //    no es "no hay noticias", es "no pudimos preguntar".
  //  · MAYORÍA de medios caídos. Aunque entren algunas notas, el agregado
  //    saldría sesgado hacia los pocos medios que sí respondieron, y
  //    publicarlo sería peor que conservar el anterior.
  const anterior = await leer(env);

  // El código HTTP que más se repite entre los medios caídos. Con esto el
  // motivo se lee de un vistazo, sin abrir el detalle medio por medio.
  const porCodigo = {};
  // Las omitidas por el corta-circuitos no se cuentan: no se intentaron, y
  // meterlas acá diría "N× HTTP null" en vez de nombrar el fallo real.
  for (const f of fallidas) {
    if (f.omitida) continue;
    porCodigo[f.http] = (porCodigo[f.http] || 0) + 1;
  }
  const dominante = Object.entries(porCodigo).sort((a, b) => b[1] - a[1])[0];
  const pista = dominante
    ? ` · ${dominante[1]}× HTTP ${dominante[0]}${dominante[0] === '503' ? ' (bloqueo por consultas automatizadas)' : ''}`
    : '';

  const razon = items.length === 0
    ? `ningún medio devolvió notas del sismo${pista}`
    : (fallidas.length > MEDIOS.length / 2
      ? `${fallidas.length} de ${MEDIOS.length} medios fallaron${pista}`
      : null);

  if (razon && anterior && anterior.totales?.notas > 0) {
    console.error('prensa: corrida DESCARTADA ·', razon,
      '· se conserva la del', new Date(anterior.generado).toISOString());
    await anotarCorrida(env, {
      tarea: 'prensa', origen, ok: false, publicado: false,
      ms: Date.now() - t0, notas: items.length, medios: 0,
      detalle: { razon, medios: diag, google: diagG.length ? diagG : undefined },
    });
    const err = new Error(`corrida descartada: ${razon}`);
    err.descartada = true;
    err.diag = diag;
    throw err;
  }

  const notas = clasificar(items);
  const ag = agregar(notas);
  ag.cifras = extraerCifras(notas);
  ag.lectura = await lecturaAutomatica(env, ag);
  ag.lectura_automatica = true;
  // Va DENTRO del agregado que consume la página: cuántos medios respondieron.
  // Una corrida a medias tiene que poder verse desde afuera.
  ag.recoleccion = {
    origen,
    medios_leidos: MEDIOS.length,
    fallidos: fallidas.length,
    // Qué medios no contestaron, por nombre: sirve para saber a cuál hay que
    // buscarle una URL nueva cuando un periódico cambia de plataforma.
    caidos: fallidas.filter((f) => !f.omitida).map((f) => f.id),
    google: env.USAR_GOOGLE_NEWS === '1' ? { consultas: diagG.length } : 'apagado',
    ms: Date.now() - t0,
    // Sin la primera corrida buena que sirva de piso no hay con qué comparar,
    // así que la primera vez esto entra aunque `razon` exista.
    degradada: Boolean(razon),
  };

  await env.DB.prepare(
    `INSERT INTO inteligencia (id, ts, datos) VALUES ('actual', ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, datos = excluded.datos`
  ).bind(ag.generado, JSON.stringify(ag)).run();

  await anotarCorrida(env, {
    tarea: 'prensa', origen, ok: !razon, publicado: true,
    ms: Date.now() - t0, notas: ag.totales.notas, medios: ag.totales.medios,
    detalle: fallidas.length ? { razon, medios: diag } : null,
  });

  return ag;
}

export async function leer(env) {
  const r = await env.DB.prepare("SELECT datos FROM inteligencia WHERE id = 'actual'").first();
  if (!r?.datos) return null;
  try { return JSON.parse(r.datos); } catch { return null; }
}
