/**
 * Mapa de necesidades · sismo del 10 de agosto de 2026
 *
 * Worker independiente a propósito: NO se toca `rr-auth`, que es compartido
 * con Caudal, el Lab y el resto del sitio. Un deploy de emergencia no puede
 * poner en riesgo lo que ya está en producción.
 *
 * Rutas
 *   GET  /snapshot.json           mapa público (coordenadas difuminadas ~100 m)
 *   GET  /fotos/:clave            imagen adjunta de un reporte (desde R2)
 *   POST /reporte                 crear reporte (la foto viaja adentro, en base64)
 *   GET  /reporte/:id?t=token     vista privada del reportante (+ sus mensajes)
 *   POST /reporte/:id/estado      cerrar/reabrir (requiere token)
 *   POST /contacto                mensaje intermediado hacia el reportante
 *   POST /abuso                   marcar un reporte para revisión
 *   POST /sugerencia              corregir / cerrar / confirmar un acopio (a revisión)
 *   GET  /necesidades.json        quién PIDE ayuda (pestaña NECESIDADES de la hoja)
 *   GET  /inteligencia.json       pulso de prensa (lo recolecta el cron, no la visita)
 *   GET  /copernicus.json         daño evaluado desde satélite (cron diario)
 *   GET  /admin/reportes          moderación (X-Admin-Token)
 *   POST /admin/estado            ocultar / verificar (X-Admin-Token)
 *   GET  /admin/sugerencias       correcciones de acopios + overlays activos
 *   POST /admin/sugerencia        aprobar / rechazar, o quitar un overlay
 *   POST /admin/inteligencia      forzar una recolección (X-Admin-Token)
 *   GET  /admin/corridas          bitácora de corridas del cron (X-Admin-Token)
 *   POST /admin/copernicus        forzar la lectura de Copernicus (X-Admin-Token)
 *   GET  /salud                   ping
 */
import {
  recolectar as recolectarPrensa, leer as leerPrensa,
  anotarCorrida, ultimaCorrida,
} from './inteligencia.js';
import { leer as leerAcopios, refrescar as refrescarAcopios, claveDe } from './acopios.js';
import { leer as leerNecesidades, refrescar as refrescarNecesidades } from './necesidades.js';
import {
  leer as leerRedacopio, refrescar as refrescarRedacopio, fusionar as fusionarRedacopio,
} from './redacopio.js';
import { leer as leerCopernicus, refrescar as refrescarCopernicus } from './copernicus.js';

/**
 * Los dos horarios del cron, para poder distinguirlos dentro de `scheduled`.
 *
 * ⚠️ TIENEN QUE SER IDÉNTICOS a los de `wrangler.toml`, carácter por carácter.
 * Cloudflare entrega la expresión tal cual está escrita allá: si se cambia una
 * y no la otra, la corrida diaria caería en la rama de prensa y Copernicus no
 * se actualizaría nunca, sin un solo error en el log.
 */
const CRON_PRENSA = '17 */3 * * *';
const CRON_DIARIO = '40 11 * * *';   // 06:40 en Colombia

/* ⚠️ El dominio desde el que se sirve la página TIENE que estar acá. Si no, el
   navegador bloquea toda respuesta de la API y el mapa se ve pero no carga
   nada, sin un error que explique por qué. El primero de la lista es también el
   que se responde a un origen desconocido. */
const ORIGENES = [
  'https://reconstruyocolombia.com',        // el dominio propio, desde ago-2026
  'https://www.reconstruyocolombia.com',
  'https://ayuda-sismo.pages.dev',
  'https://ricardoruiz.co',
  'http://localhost:8765',
  'http://localhost:8766',
  'http://127.0.0.1:8765',
];

/**
 * Catálogo de SITUACIONES. Sustituye a la matriz tipo × categoría, que
 * generaba 18 combinaciones de las cuales la mitad no significaba nada
 * ("ofrezco + mascota" no distingue entre buscar a mi perro y haber
 * encontrado uno). Acá cada entrada es una situación concreta y las
 * combinaciones absurdas simplemente no existen.
 *
 *   priv: el contacto NUNCA se publica, decida lo que decida el usuario.
 *   foto: admite imagen adjunta.
 */
const SITUACIONES = {
  'busco-persona':   { tipo:'busco',    cat:'persona',     priv:true, foto:true },
  'busco-mascota':   { tipo:'busco',    cat:'mascota',                foto:true },

  'nec-rescate':     { tipo:'necesito', cat:'rescate' },
  'nec-viveres':     { tipo:'necesito', cat:'viveres' },
  'nec-salud':       { tipo:'necesito', cat:'salud' },
  'nec-refugio':     { tipo:'necesito', cat:'refugio' },
  'nec-estructural': { tipo:'necesito', cat:'estructural',            foto:true },
  'nec-servicios':   { tipo:'necesito', cat:'servicios' },
  // Categoría propia, no un rincón de 'salud': quien necesita acompañamiento
  // emocional no se reconoce en "atención médica", y separarlas es lo que deja
  // cruzar por el filtro a quien lo pide con quien lo ofrece.
  'nec-psicologico': { tipo:'necesito', cat:'psicologico' },
  'nec-otro':        { tipo:'necesito', cat:'otro' },

  // Haber encontrado a una persona desorientada o herida NO admite foto:
  // publicar la imagen de alguien que no puede consentir es un problema de
  // dignidad, y para reencontrarla basta la descripción y el lugar.
  'ofr-persona':     { tipo:'ofrezco',  cat:'persona',     priv:true },
  'ofr-mascota':     { tipo:'ofrezco',  cat:'mascota',                foto:true },
  'ofr-alojamiento': { tipo:'ofrezco',  cat:'refugio' },
  'ofr-viveres':     { tipo:'ofrezco',  cat:'viveres' },
  'ofr-salud':       { tipo:'ofrezco',  cat:'salud' },
  'ofr-psicologico': { tipo:'ofrezco',  cat:'psicologico' },
  'ofr-transporte':  { tipo:'ofrezco',  cat:'transporte' },
  'ofr-voluntario':  { tipo:'ofrezco',  cat:'rescate' },
  'ofr-otro':        { tipo:'ofrezco',  cat:'otro' },
};

/* ⚠️ 'inmediata' es el nivel nuevo, por encima de 'alta'. El orden importa:
   inmediata > alta > media > baja. Los reportes viejos siguen en su nivel y
   no hay que migrar nada; lo que NO puede pasar es que el Worker rechace el
   valor nuevo y lo degrade a 'media' en silencio —un rescate quedaría
   archivado como algo que puede esperar una semana—. */
const URGENCIAS = new Set(['inmediata', 'alta', 'media', 'baja']);
const ESTADOS = new Set(['activo', 'resuelto', 'oculto']);

const LIMITES = {
  reportesPorHora: 5, mensajesPorHora: 20, abusosPorHora: 30,
  // Más alto que los reportes a propósito: corregir es barato y no publica
  // nada solo. Quien va llegando a un acopio tras otro puede corregir varios
  // seguidos, y frenarlo a los cinco sería castigar justo al que ayuda.
  sugerenciasPorHora: 12,
};

/* Correcciones sobre un acopio.
     correccion   cambia campos de la ficha
     cierre       el sitio ya no recibe
     confirmacion sigue igual y alguien lo verificó — es lo que llena la
                  columna de revisión, que está vacía en casi toda la hoja */
const SUG_TIPOS = new Set(['correccion', 'cierre', 'confirmacion']);

/* Campos corregibles y su tope. NO están el nombre (es la llave que amarra la
   corrección con su acopio) ni la ubicación (mover un pin desde un formulario
   anónimo manda gente a otra dirección). Los dos se piden por la nota. */
const SUG_CAMPOS = { d: 140, ne: 300, ab: 24, ci: 24, di: 40, tel: 60, c: 120 };

// Fotos: se reciben DENTRO de /reporte en base64, no por un endpoint propio.
// Un endpoint de subida suelto sería un almacenamiento abierto a internet;
// así la imagen hereda el límite por IP, el captcha y la validación del
// reporte al que pertenece.
const FOTO_MAX_BYTES = 1_200_000;
const FOTO_TIPOS = { 'image/jpeg':'jpg', 'image/webp':'webp' };

// Colombia continental + San Andrés. Un pin fuera de esto es error o basura.
const BBOX = { latMin: -4.3, latMax: 13.6, lonMin: -82.0, lonMax: -66.8 };

const RADIO_BLUR_M = 100;

// ─────────────────────────────── utilidades ───────────────────────────────

function cors(origin) {
  const permitido = ORIGENES.includes(origin) ? origin : ORIGENES[0];
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Vary': 'Origin',
  };
}

function json(data, status, origin, extra = {}) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), ...extra },
  });
}

/**
 * Recorta, quita caracteres de control y normaliza espacios.
 *
 * Se preservan los saltos de linea y tabuladores reales. U+0085 y
 * U+2028/2029 entran al filtro porque cuentan como salto de linea para
 * muchos parsers y parten registros donde no hay salto real.
 */
function limpiar(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u2028\u2029]/g, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s.slice(0, max);
}

/**
 * Enmascara teléfonos y correos dentro del texto libre.
 *
 * ⚠️ Sin esto la decisión de "no publicar el contacto" no vale nada: basta que
 * alguien escriba su celular dentro de la descripción para que quede expuesto,
 * y en desaparecidos ese es justo el dato que habilita la llamada extorsiva.
 *
 * ⚠️⚠️ PERO SOLO PROTEGE A QUIEN PIDE. Un reporte del grupo `ofrezco` es lo
 * contrario: una línea de atención psicológica, una brigada médica o alguien
 * con una camioneta PUBLICAN su número justamente para que los llamen, y
 * taparlo borra la única forma de usar lo que están ofreciendo. Se vio en la
 * línea gratuita de la Konrad Lorenz, que quedó publicada con un
 * "[teléfono oculto]" donde iba el número de registro.
 *
 * El riesgo que motivó esto —la llamada extorsiva a una familia que busca a
 * alguien— no existe del lado de la oferta: no hay a quién extorsionar con
 * una oferta de ayuda, y quien la publica ya decidió exponerse.
 */
function enmascarar(texto) {
  if (!texto) return texto;
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo oculto]')
    // 7+ dígitos seguidos, tolerando espacios, puntos y guiones entre ellos
    .replace(/(?:\+?\d[\d\s.\-()]{6,}\d)/g, (m) =>
      (m.replace(/\D/g, '').length >= 7 ? '[teléfono oculto]' : m));
}

function esNumero(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Desplaza el punto a una posición aleatoria dentro de un disco de 100 m.
 *
 * Aleatorio y no redondeado a propósito: redondear crea una rejilla en la que
 * los puntos se apilan en el mismo vértice y se delata la manzana. Se calcula
 * UNA vez y se guarda; recalcular por lectura permitiría promediar capturas
 * sucesivas y recuperar el punto real.
 */
function difuminar(lat, lon) {
  const u = Math.random();
  const ang = Math.random() * 2 * Math.PI;
  const r = RADIO_BLUR_M * Math.sqrt(u);          // uniforme en área, no en radio
  const dLat = (r * Math.cos(ang)) / 111320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLon = (r * Math.sin(ang)) / (111320 * (Math.abs(cos) < 1e-6 ? 1e-6 : cos));
  return [Number((lat + dLat).toFixed(5)), Number((lon + dLon).toFixed(5))];
}

async function hashIp(ip, salt) {
  const buf = new TextEncoder().encode(`${salt || 'sismo'}::${ip || 'sin-ip'}`);
  const dig = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(dig)].slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifica Turnstile. Devuelve { ok, verificado }.
 *
 * Si el secreto no está configurado NO se bloquea el formulario —tumbar la
 * recepción de reportes en plena emergencia es peor que recibir spam— pero el
 * reporte queda marcado `sin_captcha` para que moderación lo mire primero.
 */
async function verificarTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return { ok: true, verificado: false };
  /* ⚠️ Token AUSENTE no se rechaza: se acepta y se marca para moderación.
     Quien tenga mala señal, un bloqueador o un navegador viejo puede no lograr
     cargar el script de Turnstile, y en este sitio eso sería impedirle reportar
     a un desaparecido. Mismo principio que el resto del módulo: tumbar la
     recepción en plena emergencia es peor que recibir spam. Le quedan encima
     el honeypot, los 5 segundos y el límite por IP.
     Token PRESENTE pero inválido sí se rechaza: eso ya es manipulación. */
  if (!token) return { ok: true, verificado: false };
  try {
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body });
    const data = await r.json();
    // Los códigos de Cloudflare distinguen "la clave secreta está mal"
    // (invalid-input-secret) de "el token es falso" (invalid-input-response).
    // Sin esto, ambos casos se ven idénticos desde afuera.
    if (!data.success) console.error('turnstile', JSON.stringify(data['error-codes'] || []));
    return { ok: !!data.success, verificado: !!data.success };
  } catch {
    // Si Cloudflare no responde, dejamos pasar y marcamos para revisión.
    return { ok: true, verificado: false };
  }
}

/* El nombre de la tabla entra a la consulta por concatenación, así que la
   lista blanca es obligatoria: sin ella esto sería inyección de SQL con un
   parámetro que hoy es interno pero mañana lo pone cualquiera. */
const TABLAS_LIMITE = new Set(['reportes', 'mensajes', 'sugerencias']);

async function bajoLimite(env, tabla, ipHash, max) {
  if (!TABLAS_LIMITE.has(tabla)) throw new Error(`tabla_no_permitida:${tabla}`);
  const desde = Date.now() - 3600_000;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${tabla} WHERE ip_hash = ? AND ts > ?`
  ).bind(ipHash, desde).first();
  return (row?.n || 0) < max;
}

/* El título lo escribe la persona: sin escapar, entra crudo al HTML del
   correo y puede alterarlo. Es texto ajeno en un documento, no una plantilla. */
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g,
  (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

/** Notificación por correo, si hay Resend. Nunca hace fallar la operación. */
async function avisarPorCorreo(env, para, asunto, html) {
  if (!env.RESEND_API_KEY || !para || !para.includes('@')) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'Mapa de ayuda <hola@ricardoruiz.co>',
        to: [para], subject: asunto, html,
      }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Decodifica y valida una foto que llegó en base64 dentro del reporte.
 *
 * Se comprueban los BYTES MÁGICOS, no el content-type que declara el cliente:
 * decir "image/jpeg" es gratis, y sin esta comprobación el bucket aceptaría
 * cualquier archivo. Devuelve { bytes, ext } o null.
 */
function decodificarFoto(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!m) return null;
  const ext = FOTO_TIPOS[m[1]];
  if (!ext) return null;

  let bin;
  try { bin = atob(m[2]); } catch { return null; }
  if (bin.length > FOTO_MAX_BYTES) return null;

  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const esJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const esWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
                 bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
                 bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!(esJpeg || esWebp)) return null;

  return { bytes, ext, tipo: m[1] };
}

async function servirFoto(clave, env, ctx, req) {
  if (!env.FOTOS) return new Response('sin almacenamiento', { status: 404 });
  const cache = caches.default;
  const golpe = await cache.match(req);
  if (golpe) return golpe;

  const obj = await env.FOTOS.get(clave);
  if (!obj) return new Response('no existe', { status: 404 });

  const res = new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      // La llave lleva un uuid: el contenido de una llave nunca cambia.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
  ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}

// ─────────────────────────────── rutas ───────────────────────────────

async function crearReporte(req, env, origin, ip) {
  let b;
  try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }

  // Honeypot: campo invisible que solo llenan los bots.
  if (limpiar(b.web, 40)) return json({ ok: true, id: 'ok' }, 200, origin);

  /* Tiempo de diligenciamiento. Una persona no llena título, ubicación y
     consentimiento en menos de cinco segundos; un bot sí.
     ⚠️ Esto NO reemplaza a Turnstile: frena al bot ingenuo, no a quien se tome
     el trabajo de falsear el campo. Es defensa en profundidad mientras el
     captcha no esté configurado. Se responde `ok` como con el honeypot, para
     no enseñarle al atacante cuál fue la regla que lo atajó. */
  const dt = Number(b.dt);
  const sospechoso = !Number.isFinite(dt) || dt < 5000;
  if (Number.isFinite(dt) && dt < 5000) return json({ ok: true, id: 'ok' }, 200, origin);

  const sit = SITUACIONES[b.sit] ? b.sit : null;
  if (!sit) return json({ error: 'situacion_invalida' }, 400, origin);
  const def = SITUACIONES[sit];

  const urgencia = URGENCIAS.has(b.urgencia) ? b.urgencia : 'media';
  const titulo = limpiar(b.titulo, 140);
  const detalle = limpiar(b.detalle, 1200);
  const depto = limpiar(b.depto, 60);
  const municipio = limpiar(b.municipio, 80);
  const barrio = limpiar(b.barrio, 90);
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  const personas = Number.isInteger(b.personas) ? Math.min(Math.max(b.personas, 0), 9999) : null;

  if (titulo.length < 5) return json({ error: 'titulo_corto' }, 400, origin);
  if (!esNumero(lat) || !esNumero(lon)) return json({ error: 'ubicacion_faltante' }, 400, origin);
  if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) {
    return json({ error: 'ubicacion_fuera_de_colombia' }, 400, origin);
  }

  const contacto = limpiar(b.contacto, 120);
  const contactoTipo = contacto.includes('@') ? 'email' : 'tel';
  // El usuario puede pedir que su contacto sea público, pero en las
  // situaciones marcadas `priv` su preferencia no aplica.
  const contactoPub = def.priv ? 0 : (b.contacto_pub ? 1 : 0);

  const ipHash = await hashIp(ip, env.IP_SALT);
  if (!(await bajoLimite(env, 'reportes', ipHash, LIMITES.reportesPorHora))) {
    return json({ error: 'demasiados_reportes', mensaje: 'Ya registraste varios reportes en la última hora. Si necesitas más, escríbenos.' }, 429, origin);
  }

  const captcha = await verificarTurnstile(b.turnstile, ip, env);
  if (!captcha.ok) return json({ error: 'captcha_invalido' }, 400, origin);

  const id = crypto.randomUUID().slice(0, 8);
  const token = crypto.randomUUID().replace(/-/g, '');
  const ahora = Date.now();
  const [plat, plon] = difuminar(lat, lon);

  // La foto solo se guarda si la situación la admite; si no, se descarta en
  // silencio en vez de confiar en que el formulario la haya escondido.
  let fotoClave = null;
  if (def.foto && b.foto && env.FOTOS) {
    const f = decodificarFoto(b.foto);
    if (f) {
      fotoClave = `fotos/${id}-${crypto.randomUUID().slice(0, 8)}.${f.ext}`;
      await env.FOTOS.put(fotoClave, f.bytes, { httpMetadata: { contentType: f.tipo } });
    }
  }

  await env.DB.prepare(`
    INSERT INTO reportes (id, ts, actualizado, sit, tipo, cat, urgencia, titulo, detalle,
      depto, municipio, barrio, personas, foto, lat, lon, plat, plon, contacto,
      contacto_tipo, contacto_pub, estado, token, ip_hash, sin_captcha)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'activo',?,?,?)
  `).bind(id, ahora, ahora, sit, def.tipo, def.cat, urgencia, titulo, detalle,
    depto, municipio, barrio, personas, fotoClave, lat, lon, plat, plon,
    contacto || null, contacto ? contactoTipo : null, contactoPub, token,
    ipHash, (captcha.verificado && !sospechoso) ? 0 : 1).run();

  // Diagnóstico del captcha, solo el último. Sirve para saber POR QUÉ un
  // reporte llegó sin verificar sin tener que leer logs en vivo.
  const diag = limpiar(b.tsdiag, 220);
  if (diag) {
    try {
      await env.DB.prepare(
        `INSERT INTO externos (id, ts, datos) VALUES ('diag-turnstile', ?, ?)
         ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, datos = excluded.datos`
      ).bind(Date.now(), JSON.stringify({ id, diag, verificado: captcha.verificado })).run();
    } catch { /* el diagnóstico nunca puede tumbar un reporte */ }
  }

  /* Enlace privado al correo del reportante.
     ⚠️ Es la única forma de recuperar un reporte desde OTRO dispositivo: el
     "Mis reportes" del sitio vive en el navegador, así que cambiar de teléfono
     o borrar datos lo dejaba sin nada. Va acá y no en una búsqueda por cédula
     porque un buscador por documento deja que cualquiera consulte los reportes
     de cualquiera —y acá hay reportes de personas desaparecidas con el
     contacto del familiar, que es justo lo que se protege—.
     Nunca hace fallar el envío: si Resend no responde, el reporte ya quedó
     guardado y la persona tiene el enlace en pantalla. */
  if (contactoTipo === 'email') {
    const base = env.SITIO || 'https://reconstruyocolombia.com';
    await avisarPorCorreo(env, contacto,
      'Tu enlace para seguir el reporte',
      `<p>Quedó publicado: <strong>${escHtml(titulo)}</strong>.</p>
       <p>Con este enlace ves los mensajes que te dejen y lo marcas como
          resuelto cuando ya no lo necesites:</p>
       <p><a href="${base}/#/mi/${id}/${token}">Abrir mi reporte</a></p>
       <p style="color:#666;font-size:13px">Nadie más tiene este enlace. No lo
          compartas: quien lo tenga puede cerrar tu reporte.</p>`);
  }

  return json({ ok: true, id, token }, 200, origin);
}

async function snapshot(req, env, ctx) {
  const cache = caches.default;
  const golpe = await cache.match(req);
  if (golpe) return golpe;

  // Solo campos públicos: lat/lon exactos y contacto privado NO salen de acá.
  const { results } = await env.DB.prepare(`
    SELECT id, ts, sit, tipo, cat, urgencia, titulo, detalle, depto, municipio,
           barrio, personas, foto, plat, plon, contacto, contacto_pub,
           verificado, abusos
      FROM reportes
     WHERE estado = 'activo'
     ORDER BY ts DESC
     LIMIT 5000
  `).all();

  const items = (results || []).map((r) => ({
    i: r.id,
    t: r.ts,
    s: r.sit,
    p: r.tipo,
    c: r.cat,
    u: r.urgencia,
    ti: r.titulo,
    // `ofrezco` publica su detalle tal cual: ver el comentario de `enmascarar`.
    d: (r.contacto_pub || r.tipo === 'ofrezco') ? r.detalle : enmascarar(r.detalle),
    dp: r.depto,
    mu: r.municipio,
    b: r.barrio,
    n: r.personas,
    fo: r.foto,
    la: r.plat,
    lo: r.plon,
    k: r.contacto_pub ? r.contacto : null,   // contacto solo si es público
    v: r.verificado ? 1 : 0,
    f: r.abusos >= 3 ? 1 : 0,                // marcado por varios usuarios
  }));

  const res = new Response(JSON.stringify({
    generado: Date.now(),
    radio_difuminado_m: RADIO_BLUR_M,
    // El formulario consulta esto para saber si puede ofrecer subir una foto.
    // Sin almacenamiento, ofrecerla igual haría que la persona la adjunte y se
    // descarte en silencio — peor que no ofrecerla.
    // `correo` dice si hay Resend configurado. Sin la llave, el aviso con el
    // enlace privado NO sale, y el formulario no puede seguir ofreciéndolo:
    // quien deja el correo esperando que le avisen se queda esperando.
    caps: { fotos: !!env.FOTOS, correo: !!env.RESEND_API_KEY },
    total: items.length,
    items,
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // El edge sirve el 99,9% de las lecturas: con esto un millón de visitas
      // no se traduce en un millón de consultas a D1.
      'Cache-Control': 'public, max-age=30, s-maxage=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
  ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}

async function verReportePrivado(id, url, env, origin) {
  const token = url.searchParams.get('t') || '';
  const r = await env.DB.prepare('SELECT * FROM reportes WHERE id = ?').bind(id).first();
  if (!r) return json({ error: 'no_existe' }, 404, origin);
  if (!token || token !== r.token) return json({ error: 'token_invalido' }, 403, origin);

  const { results } = await env.DB.prepare(
    'SELECT id, ts, mensaje, de FROM mensajes WHERE reporte_id = ? ORDER BY ts DESC LIMIT 200'
  ).bind(id).all();

  await env.DB.prepare('UPDATE mensajes SET leido = 1 WHERE reporte_id = ?').bind(id).run();

  return json({
    ok: true,
    reporte: {
      // Mismo desliz que en la moderación: acá `r.ciudad` no reventaba, solo
      // llegaba `undefined` y "Mis reportes" mostraba la línea de ubicación en
      // blanco. El frontend lee `municipio` y `depto`.
      id: r.id, ts: r.ts, sit: r.sit, tipo: r.tipo, cat: r.cat, urgencia: r.urgencia,
      titulo: r.titulo, detalle: r.detalle,
      depto: r.depto, municipio: r.municipio, barrio: r.barrio,
      lat: r.lat, lon: r.lon, estado: r.estado, contacto: r.contacto,
      contacto_pub: r.contacto_pub,
    },
    mensajes: results || [],
  }, 200, origin);
}

async function cambiarEstado(id, req, env, origin, ctx) {
  let b; try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }
  const estado = ESTADOS.has(b.estado) ? b.estado : null;
  if (!estado || estado === 'oculto') return json({ error: 'estado_invalido' }, 400, origin);

  const r = await env.DB.prepare('SELECT token FROM reportes WHERE id = ?').bind(id).first();
  if (!r) return json({ error: 'no_existe' }, 404, origin);
  if (!b.token || b.token !== r.token) return json({ error: 'token_invalido' }, 403, origin);

  await env.DB.prepare('UPDATE reportes SET estado = ?, actualizado = ? WHERE id = ?')
    .bind(estado, Date.now(), id).run();

  /* ⚠️ Se purga el snapshot igual que cuando modera un administrador. Sin esto,
     una necesidad marcada como resuelta seguía en el mapa hasta un minuto, y en
     una emergencia ese minuto manda a alguien a un sitio ya atendido —o deja
     buscando a una persona que ya apareció—. Es la misma prioridad que moderar
     algo grave: el dato viejo estorba. */
  if (env.API_BASE && ctx) {
    try {
      ctx.waitUntil(caches.default.delete(new Request(`${env.API_BASE}/snapshot.json`)));
    } catch (e) {
      console.error('purga de cache fallida', e && e.message);
    }
  }
  return json({ ok: true, estado }, 200, origin);
}

async function contactar(req, env, origin, ip) {
  let b; try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }
  if (limpiar(b.web, 40)) return json({ ok: true }, 200, origin);

  const id = limpiar(b.reporte, 40);
  const mensaje = limpiar(b.mensaje, 1500);
  const de = limpiar(b.de, 140);
  if (!id || mensaje.length < 10) return json({ error: 'mensaje_corto' }, 400, origin);

  const ipHash = await hashIp(ip, env.IP_SALT);
  if (!(await bajoLimite(env, 'mensajes', ipHash, LIMITES.mensajesPorHora))) {
    return json({ error: 'demasiados_mensajes' }, 429, origin);
  }
  const captcha = await verificarTurnstile(b.turnstile, ip, env);
  if (!captcha.ok) return json({ error: 'captcha_invalido' }, 400, origin);

  const r = await env.DB.prepare(
    "SELECT id, titulo, contacto, contacto_tipo, token FROM reportes WHERE id = ? AND estado = 'activo'"
  ).bind(id).first();
  if (!r) return json({ error: 'no_existe' }, 404, origin);

  await env.DB.prepare(
    'INSERT INTO mensajes (id, reporte_id, ts, mensaje, de, ip_hash) VALUES (?,?,?,?,?,?)'
  ).bind(crypto.randomUUID().slice(0, 10), id, Date.now(), mensaje, de || null, ipHash).run();

  // Aviso al reportante, si dejó correo. El mensaje NO viaja en el correo:
  // se avisa y se manda al enlace privado, para que un buzón comprometido no
  // exponga la conversación completa.
  if (r.contacto_tipo === 'email') {
    const base = env.SITIO || 'https://reconstruyocolombia.com';
    await avisarPorCorreo(env, r.contacto,
      'Tienes un mensaje nuevo sobre tu reporte',
      `<p>Alguien respondió a tu reporte <strong>${escHtml(r.titulo)}</strong>.</p>
       <p><a href="${base}/#/mi/${r.id}/${r.token}">Abrir mis mensajes</a></p>
       <p style="color:#666;font-size:13px">Nadie más tiene este enlace. No lo compartas.</p>`);
  }
  return json({ ok: true }, 200, origin);
}

async function reportarAbuso(req, env, origin, ip) {
  let b; try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }
  const id = limpiar(b.reporte, 40);
  if (!id) return json({ error: 'falta_id' }, 400, origin);

  const ipHash = await hashIp(ip, env.IP_SALT);

  // Una marca por IP y por reporte: la llave primaria de abuso_log lo impone.
  // Si ya existía, INSERT OR IGNORE no cambia filas y el contador no se toca.
  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO abuso_log (reporte_id, ip_hash, ts) VALUES (?,?,?)'
  ).bind(id, ipHash, Date.now()).run();
  const nuevo = (ins?.meta?.changes || 0) > 0;

  // Se cuenta y se marca para revisión, pero NO se oculta solo: si bastaran
  // unos clics para tumbar un reporte, una campaña coordinada podría borrar
  // del mapa justo los casos reales.
  if (nuevo) {
    await env.DB.prepare('UPDATE reportes SET abusos = abusos + 1 WHERE id = ?').bind(id).run();
  }
  return json({ ok: true }, 200, origin);
}

/**
 * Corrección sobre un acopio: cambió algo, cerró, o sigue igual.
 *
 * ⚠️⚠️ NO cambia el mapa. Queda pendiente hasta que alguien la apruebe en el
 * panel. Es la diferencia entre corregir y vandalizar: acá cualquiera puede
 * decir "este acopio cerró", y si eso apagara el pin al instante bastaría un
 * formulario para borrar del mapa los acopios que sí están operando.
 *
 * La respuesta es la misma se apruebe o no —"recibido"—: quien corrige no
 * tiene por qué esperar en línea a que un humano revise.
 */
async function crearSugerencia(req, env, origin, ip) {
  let b; try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }

  // Honeypot y tiempo de diligenciamiento: mismo criterio que /reporte, y se
  // responde `ok` para no enseñarle al bot cuál de las dos reglas lo atajó.
  if (limpiar(b.web, 40)) return json({ ok: true }, 200, origin);
  const dt = Number(b.dt);
  const sospechoso = !Number.isFinite(dt) || dt < 4000;
  if (Number.isFinite(dt) && dt < 4000) return json({ ok: true }, 200, origin);

  const tipo = SUG_TIPOS.has(b.tipo) ? b.tipo : null;
  if (!tipo) return json({ error: 'tipo_invalido' }, 400, origin);

  const clave = limpiar(b.clave, 200);
  if (!clave) return json({ error: 'falta_acopio' }, 400, origin);

  /* La llave se valida contra la lista real de acopios, y de ahí salen también
     el nombre y el municipio que verá el panel.
     ⚠️ No se toman del cuerpo del mensaje: quien envía podría escribir
     cualquier nombre y la corrección aparecería en el panel disfrazada de otro
     acopio. Lo único que se acepta del cliente es a CUÁL se refiere. */
  const acopios = await leerAcopios(env);
  const item = (acopios.items || []).find((a) => (a.k || claveDe(a.n, a.mu)) === clave);
  if (!item) return json({ error: 'acopio_desconocido' }, 400, origin);

  const nota = limpiar(b.nota, 600);
  // Cerrar un acopio es lo más destructivo que se puede pedir acá, así que
  // pide una razón: "fui esta mañana y estaba cerrado" es verificable, un
  // clic suelto no.
  if (tipo === 'cierre' && nota.length < 4) return json({ error: 'falta_motivo' }, 400, origin);

  // Solo entra lo que de verdad cambia. Guardar el valor viejo al lado es lo
  // que deja aprobar mirando la tarjeta, sin abrir la hoja a comparar.
  const campos = {};
  if (tipo === 'correccion') {
    for (const [c, max] of Object.entries(SUG_CAMPOS)) {
      if (b[c] === undefined || b[c] === null) continue;
      const nuevo = limpiar(b[c], max);
      const viejo = String(item[c] ?? '');
      if (nuevo === viejo) continue;
      campos[c] = { de: viejo, a: nuevo };
    }
    if (b.vol !== undefined && !!b.vol !== !!item.vol) {
      campos.vol = { de: !!item.vol, a: !!b.vol };
    }
    if (!Object.keys(campos).length && !nota) return json({ error: 'sin_cambios' }, 400, origin);
  }

  const ipHash = await hashIp(ip, env.IP_SALT);
  if (!(await bajoLimite(env, 'sugerencias', ipHash, LIMITES.sugerenciasPorHora))) {
    return json({ error: 'demasiadas', mensaje: 'Ya enviaste varias correcciones en la última hora.' }, 429, origin);
  }

  /* Una misma persona no puede apilar la misma corrección sobre el mismo
     acopio. Sin esto, el panel se llenaría de veinte tarjetas idénticas y el
     conteo de "cuánta gente dice que cerró" —que es la señal que sirve para
     decidir— dejaría de significar algo. */
  const repetida = await env.DB.prepare(
    `SELECT id FROM sugerencias
      WHERE ip_hash = ? AND clave = ? AND tipo = ? AND estado = 'pendiente' AND ts > ?`
  ).bind(ipHash, clave, tipo, Date.now() - 86400_000).first();
  if (repetida) return json({ ok: true, repetida: true }, 200, origin);

  const captcha = await verificarTurnstile(b.turnstile, ip, env);
  if (!captcha.ok) return json({ error: 'captcha_invalido' }, 400, origin);

  const id = crypto.randomUUID().slice(0, 10);
  await env.DB.prepare(`
    INSERT INTO sugerencias (id, ts, clave, acopio, municipio, depto, tipo, campos,
      nota, contacto, estado, ip_hash, sin_captcha)
    VALUES (?,?,?,?,?,?,?,?,?,?,'pendiente',?,?)
  `).bind(id, Date.now(), clave, item.n, item.mu || null, item.dp || null, tipo,
    JSON.stringify(campos), nota || null, limpiar(b.contacto, 120) || null,
    ipHash, (captcha.verificado && !sospechoso) ? 0 : 1).run();

  return json({ ok: true, id }, 200, origin);
}

function guardAdmin(req, env) {
  const t = req.headers.get('X-Admin-Token') || '';
  if (!env.ADMIN_TOKEN || t.length < 16) return false;
  // Comparación de tiempo constante.
  if (t.length !== env.ADMIN_TOKEN.length) return false;
  let dif = 0;
  for (let i = 0; i < t.length; i++) dif |= t.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  return dif === 0;
}

async function adminReportes(url, env, origin) {
  const estado = ESTADOS.has(url.searchParams.get('estado')) ? url.searchParams.get('estado') : null;
  const soloAlerta = url.searchParams.get('alerta') === '1';
  const cond = [];
  if (estado) cond.push(`estado = '${estado}'`);
  if (soloAlerta) cond.push('(abusos >= 1 OR sin_captcha = 1)');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  // ⚠️ Son `depto` y `municipio`, NO `ciudad`: esa columna no existe en el
  // esquema, así que la consulta entera fallaba y la moderación llevaba caída
  // con un 500 sin que nada lo dijera. `sit` entra porque es la situación
  // concreta que eligió la persona; sin ella no se distingue un acopio
  // registrado desde la página de una oferta de víveres cualquiera.
  const { results } = await env.DB.prepare(`
    SELECT id, ts, sit, tipo, cat, urgencia, titulo, detalle, depto, municipio, barrio,
           personas, lat, lon, contacto, contacto_pub, estado, abusos, sin_captcha, verificado
      FROM reportes ${where} ORDER BY ts DESC LIMIT 1000
  `).all();
  return json({ ok: true, total: (results || []).length, items: results || [] }, 200, origin);
}

async function adminEstado(req, env, origin, ctx) {
  let b; try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }
  const id = limpiar(b.id, 40);
  if (!id) return json({ error: 'falta_id' }, 400, origin);

  if (b.verificado !== undefined) {
    await env.DB.prepare('UPDATE reportes SET verificado = ?, actualizado = ? WHERE id = ?')
      .bind(b.verificado ? 1 : 0, Date.now(), id).run();
  }
  if (b.estado && ESTADOS.has(b.estado)) {
    await env.DB.prepare('UPDATE reportes SET estado = ?, actualizado = ? WHERE id = ?')
      .bind(b.estado, Date.now(), id).run();

    // Ocultar por moderación tiene que llevarse la imagen: la URL de la foto
    // es adivinable por quien ya la vio, y dejarla accesible haría que
    // "ocultar" solo la quitara del mapa, no de internet.
    if (b.estado === 'oculto' && env.FOTOS) {
      const r = await env.DB.prepare('SELECT foto FROM reportes WHERE id = ?').bind(id).first();
      if (r?.foto) {
        await env.FOTOS.delete(r.foto);
        await env.DB.prepare('UPDATE reportes SET foto = NULL WHERE id = ?').bind(id).run();
      }
    }
  }
  // El snapshot vive 60 s en el edge; moderar algo grave no debería esperar.
  // Sin API_BASE la URL sería relativa y `new Request` lanzaría: se omite el
  // purgado y el cambio entra al minuto, en vez de tumbar la respuesta.
  if (env.API_BASE) {
    try {
      ctx.waitUntil(caches.default.delete(new Request(`${env.API_BASE}/snapshot.json`)));
    } catch (e) {
      console.error('purga de cache fallida', e && e.message);
    }
  }
  return json({ ok: true }, 200, origin);
}

/**
 * Todo lo que el panel necesita para decidir, en una sola consulta.
 *
 * Cada corrección viaja con el valor ACTUAL del acopio al lado, no solo con el
 * que tenía cuando se envió: entre que alguien corrigió y alguien revisa, la
 * hoja pudo cambiar, y aprobar contra un "antes" viejo reviviría un dato que
 * ya estaba arreglado.
 */
/**
 * Los acopios de la hoja, con lo que RedAcopio Bogotá sabe encima.
 *
 * ⚠️⚠️ La fusión se hace al SERVIR, no al refrescar. Si se guardara fusionado
 * en `externos.acopios`, la siguiente corrida fusionaría sobre lo ya fusionado
 * y los puntos de ellos se volverían indistinguibles de los nuestros — y
 * apagar la integración dejaría de ser posible sin limpiar la tabla a mano.
 * Así, `externos.acopios` sigue siendo la hoja y nada más.
 *
 * ⚠️ Falla hacia adelante: si su lectura no está o está vieja, se sirven los
 * acopios tal cual. Quien va de camino a entregar un mercado no puede quedarse
 * sin mapa porque la página de un tercero cambió de formato.
 */
async function acopiosFusionados(env) {
  const d = await leerAcopios(env);
  if (!env.REDACOPIO_URL || !Array.isArray(d.items)) return d;
  try {
    const ra = await leerRedacopio(env);
    if (!ra || !ra.items || !ra.items.length) return d;
    const items = d.items.slice();
    const f = fusionarRedacopio(items, ra.items);
    return { ...d, items, total: items.length,
      horarios_vencidos: items.filter((i) => i.av).length, redacopio: {
      generado: ra.generado, fuente: ra.fuente, fuente_url: ra.fuente_url,
      enriquecidos: f.enriquecidos, nuevos: f.nuevos,
      omitidos_cerrados: f.omitidos, candidatos_a_cerrar: f.candidatos.length,
    } };
  } catch (e) {
    console.error('fusión con redacopio falló', e && e.message);
    return d;
  }
}

async function adminSugerencias(url, env, origin) {
  const estado = ['pendiente', 'aplicada', 'rechazada'].includes(url.searchParams.get('estado'))
    ? url.searchParams.get('estado') : 'pendiente';
  const todas = url.searchParams.get('estado') === 'todas';

  const { results } = await env.DB.prepare(`
    SELECT id, ts, clave, acopio, municipio, depto, tipo, campos, nota, contacto,
           estado, sin_captcha, revisado
      FROM sugerencias ${todas ? '' : 'WHERE estado = ?'}
     ORDER BY ts DESC LIMIT 400
  `).bind(...(todas ? [] : [estado])).all();

  const acopios = await leerAcopios(env);
  const porClave = new Map();
  for (const a of acopios.items || []) porClave.set(a.k || claveDe(a.n, a.mu), a);

  const items = (results || []).map((s) => {
    const a = porClave.get(s.clave);
    return {
      ...s,
      campos: (() => { try { return JSON.parse(s.campos) || {}; } catch { return {}; } })(),
      // `huerfana` = el acopio ya no está en la hoja (lo borraron, o le
      // cambiaron el nombre y con eso la llave). Aprobarla no haría nada, así
      // que el panel lo dice en vez de dejar el botón mintiendo.
      huerfana: !a,
      actual: a ? {
        d: a.d, ne: a.ne, ab: a.ab, ci: a.ci, di: a.di,
        tel: a.tel, c: a.c, vol: !!a.vol, rev: a.rev, tipo: a.tipo,
      } : null,
    };
  });

  // Cuántas personas distintas dicen lo mismo del mismo acopio. Una sola
  // persona diciendo "cerró" es un dato; cuatro es casi una certeza.
  const apoyos = {};
  for (const s of items) {
    if (s.estado !== 'pendiente') continue;
    const k = `${s.clave}|${s.tipo}`;
    apoyos[k] = (apoyos[k] || 0) + 1;
  }

  let overlays = [];
  try {
    const r = await env.DB.prepare(
      'SELECT clave, ts, campos, origen FROM acopio_overlay ORDER BY ts DESC'
    ).all();
    overlays = (r.results || []).map((o) => {
      const a = porClave.get(o.clave);
      return {
        ...o,
        campos: (() => { try { return JSON.parse(o.campos) || {}; } catch { return {}; } })(),
        // ⚠️ Un overlay de cierre saca su acopio de la lista, así que acá NO
        // se puede leer "sin acopio" como huérfano: sería marcar como rota
        // justo la corrección que está funcionando. El nombre se recupera de
        // la llave cuando no hay fila que consultar.
        acopio: a ? a.n : (o.clave.split('|')[0] || o.clave),
      };
    });
  } catch { /* esquema sin aplicar: el panel funciona igual, sin esta sección */ }

  const pendientes = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sugerencias WHERE estado = 'pendiente'"
  ).first().catch(() => ({ n: 0 }));

  return json({
    ok: true, total: items.length, pendientes: pendientes?.n || 0,
    items, apoyos, overlays,
    acopios: { total: acopios.total || 0, generado: acopios.generado },
  }, 200, origin);
}

/**
 * Aprobar, rechazar, o retirar un cambio ya aplicado.
 *
 * Aprobar escribe en `acopio_overlay` y refresca los acopios en el acto: si el
 * cambio esperara al cron, aprobar "este acopio cerró" dejaría el pin puesto
 * hasta tres horas, que es justo lo que se está tratando de evitar.
 */
/**
 * Le cuenta a quien mandó una corrección en qué paró.
 *
 * ⚠️ Quien va hasta un acopio y se toma el trabajo de escribir que ya no
 * recibe es el ÚNICO sensor que tenemos para saber que un punto dejó de
 * operar: la hoja no se entera sola. Sin acuse, esa persona reporta una vez y
 * no vuelve, y nosotros seguimos mandando gente a puertas cerradas hasta que
 * aparezca otra igual de generosa.
 *
 * Nunca hace fallar la moderación: va en `waitUntil` y `avisarPorCorreo` se
 * traga sus propios errores. Sin `RESEND_API_KEY` simplemente no manda nada.
 */
async function avisarACorrector(env, s, resultado) {
  const para = String(s.contacto || '').trim();
  if (!para.includes('@')) return false;      // dejó teléfono, o nada

  const sitio = env.SITIO || 'https://reconstruyocolombia.com';
  const donde = escHtml(s.acopio) + (s.municipio ? ` (${escHtml(s.municipio)})` : '');

  /* ⚠️ "Rechazada" es la palabra de la base de datos, no la que va en el
     correo. A quien fue hasta allá y avisó no se le contesta que su reporte
     fue rechazado: se le dice qué pasó y se le deja la puerta abierta. */
  const APLICADA = {
    cierre: `Verificamos lo que nos contaste y <b>ya quitamos ${donde} del mapa</b>.`,
    correccion: `Verificamos lo que nos contaste y <b>ya corregimos la información de ${donde}</b>.`,
    confirmacion: `Gracias por confirmar que ${donde} sigue funcionando: <b>ya quedó marcado como revisado</b> en el mapa, con la fecha de hoy.`,
  };
  const cuerpo = resultado === 'aplicada'
    ? (APLICADA[s.tipo] || APLICADA.correccion)
    : `Revisamos lo que nos contaste sobre ${donde} y por ahora lo dejamos como
       estaba, porque nos llegó información distinta de otra fuente. Puede que
       nos estemos equivocando nosotros: si volviste a pasar por ahí y sigue
       igual, cuéntanos otra vez y le damos prioridad.`;

  const asunto = resultado === 'aplicada'
    ? 'Gracias — tu reporte ya cambió el mapa'
    : 'Sobre el punto que nos reportaste';

  return avisarPorCorreo(env, para, asunto, `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
                max-width:520px;color:#16130f;line-height:1.55">
      <p>Hola,</p>
      <p>${cuerpo}</p>
      ${s.nota ? `<p style="color:#5d574e;border-left:3px solid #e0dbd2;padding-left:.8rem;
        margin:1rem 0">Nos escribiste: “${escHtml(s.nota)}”</p>` : ''}
      <p>Gracias por tomarte el trabajo de avisarnos. Sin gente que nos cuente lo
         que ve en la calle, un punto que cerró se queda publicado y le hace
         perder el viaje al que va con un mercado.</p>
      <p>Si ves otro punto que ya cerró o que no está recibiendo, el botón
         <b>“Corregir o avisar que cerró”</b> está en la ficha de cada acopio del mapa:
         <a href="${sitio}">${sitio.replace(/^https?:\/\//, '')}</a></p>
      <p style="color:#8a8378;font-size:.9rem">Este es un correo automático de un
         mapa ciudadano; no es un canal oficial de emergencias. Si hay vidas en
         riesgo, la línea es el 123.</p>
    </div>`);
}

async function adminSugerencia(req, env, origin, ctx) {
  let b; try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }
  const accion = ['aprobar', 'rechazar', 'quitar'].includes(b.accion) ? b.accion : null;
  if (!accion) return json({ error: 'accion_invalida' }, 400, origin);

  const purgar = async () => {
    // Los acopios viven 300 s en el edge. Aprobar un cierre y que el pin siga
    // ahí cinco minutos es exactamente el problema que esto resuelve.
    if (!env.API_BASE) return;
    try { await caches.default.delete(new Request(`${env.API_BASE}/acopios.json`)); }
    catch (e) { console.error('purga de acopios fallida', e && e.message); }
  };

  // Retirar un overlay: se usa cuando el cambio YA quedó escrito en la hoja y
  // el puente sobra. (Igual se limpia solo, pero poder hacerlo a mano evita
  // esperar al siguiente refresco.)
  if (accion === 'quitar') {
    const clave = limpiar(b.clave, 200);
    if (!clave) return json({ error: 'falta_clave' }, 400, origin);
    await env.DB.prepare('DELETE FROM acopio_overlay WHERE clave = ?').bind(clave).run();
    await refrescarAcopios(env);
    ctx.waitUntil(purgar());
    return json({ ok: true }, 200, origin);
  }

  const id = limpiar(b.id, 40);
  if (!id) return json({ error: 'falta_id' }, 400, origin);
  const s = await env.DB.prepare('SELECT * FROM sugerencias WHERE id = ?').bind(id).first();
  if (!s) return json({ error: 'no_existe' }, 404, origin);

  if (accion === 'rechazar') {
    await env.DB.prepare("UPDATE sugerencias SET estado = 'rechazada', revisado = ? WHERE id = ?")
      .bind(Date.now(), id).run();
    ctx.waitUntil(avisarACorrector(env, s, 'rechazada'));
    return json({ ok: true, estado: 'rechazada' }, 200, origin);
  }

  // ── aprobar ──
  let campos = {};
  try { campos = JSON.parse(s.campos) || {}; } catch { /* sin cambios de campo */ }

  const nuevo = {};
  if (s.tipo === 'cierre') {
    nuevo.cerrado = 1;
  } else if (s.tipo === 'confirmacion') {
    // Confirmar es lo que llena la columna de revisión, que está vacía en casi
    // toda la hoja: el sello pasa de "sin revisar" a "revisado {fecha}".
    nuevo.rev = new Date().toISOString().slice(0, 10);
  } else {
    for (const [c, v] of Object.entries(campos)) {
      if (!v || typeof v !== 'object') continue;
      nuevo[c] = c === 'vol' ? (v.a ? 1 : 0) : String(v.a ?? '');
    }
    // Aprobar una corrección implica que alguien la miró: vale como revisión.
    if (Object.keys(nuevo).length) nuevo.rev = new Date().toISOString().slice(0, 10);
  }
  if (!Object.keys(nuevo).length) {
    return json({ error: 'nada_que_aplicar' }, 400, origin);
  }

  // Se FUNDE con lo que ya hubiera para ese acopio, no lo reemplaza: dos
  // correcciones distintas —una del horario, otra del teléfono— tienen que
  // poder convivir, y la segunda no puede deshacer la primera.
  let previo = {};
  try {
    const row = await env.DB.prepare('SELECT campos FROM acopio_overlay WHERE clave = ?')
      .bind(s.clave).first();
    if (row?.campos) previo = JSON.parse(row.campos) || {};
  } catch { /* primera corrección de este acopio */ }

  // Reabrir es quitar el cierre, no acumularlo encima.
  if (s.tipo !== 'cierre') delete previo.cerrado;

  await env.DB.prepare(`
    INSERT INTO acopio_overlay (clave, ts, campos, origen) VALUES (?,?,?,?)
    ON CONFLICT(clave) DO UPDATE SET ts = excluded.ts, campos = excluded.campos,
                                     origen = excluded.origen
  `).bind(s.clave, Date.now(), JSON.stringify({ ...previo, ...nuevo }), id).run();

  await env.DB.prepare("UPDATE sugerencias SET estado = 'aplicada', revisado = ? WHERE id = ?")
    .bind(Date.now(), id).run();

  /* Las demás correcciones pendientes del MISMO acopio y del MISMO tipo ya
     quedaron resueltas por esta: si tres personas avisaron que cerró, aprobar
     una deja las otras dos como ruido pendiente para siempre. */
  await env.DB.prepare(`
    UPDATE sugerencias SET estado = 'aplicada', revisado = ?
     WHERE clave = ? AND tipo = ? AND estado = 'pendiente'
  `).bind(Date.now(), s.clave, s.tipo).run();

  ctx.waitUntil(avisarACorrector(env, s, 'aplicada'));

  // Sin geocodificar: son ~1 s por búsqueda y acá se está esperando en línea.
  const d = await refrescarAcopios(env);
  ctx.waitUntil(purgar());
  return json({ ok: true, estado: 'aplicada', total: d?.total, cerrados: d?.cerrados }, 200, origin);
}

// ─────────────────────────────── router ───────────────────────────────

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const ip = req.headers.get('CF-Connecting-IP') || '';
    const ruta = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    try {
      if (ruta === '/salud') return json({ ok: true, ts: Date.now() }, 200, origin);
      if (ruta === '/snapshot.json' && req.method === 'GET') return snapshot(req, env, ctx);

      const mFoto = ruta.match(/^\/(fotos\/[\w.-]{6,80})$/);
      if (mFoto && req.method === 'GET') return servirFoto(mFoto[1], env, ctx, req);

      if (ruta === '/acopios.json' && req.method === 'GET') {
        const d = await acopiosFusionados(env);
        return json(d, 200, origin, {
          // Se edita en vivo, así que la ventana es corta; aun así el edge
          // absorbe el grueso y Google no ve una petición por visitante.
          'Cache-Control': 'public, max-age=60, s-maxage=300',
        });
      }

      /* Quién PIDE ayuda. Aparte de /acopios.json y no dentro: son dos
         decisiones distintas para quien mira el mapa (a dónde llevo lo que
         tengo vs. quién está pidiendo qué), y así una falla en la pestaña
         nueva no puede dejar sin acopios al que va de camino. */
      if (ruta === '/necesidades.json' && req.method === 'GET') {
        const d = await leerNecesidades(env);
        return json(d, 200, origin, {
          'Cache-Control': 'public, max-age=60, s-maxage=300',
        });
      }

      if (ruta === '/inteligencia.json' && req.method === 'GET') {
        const [d, corrida] = await Promise.all([leerPrensa(env), ultimaCorrida(env, 'prensa')]);
        // Todavía sin corrida del cron: se responde 200 con `vacio`, no un
        // error, para que la página muestre "aún no hay lectura" en vez de
        // parecer rota.
        //
        // `ultima_corrida` viaja SIEMPRE, aunque el agregado sea el de hace
        // horas: es lo que permite ver desde afuera que el cron se está
        // cayendo. Sin esto, un agregado viejo se ve igual que uno fresco.
        const cuerpo = d ? { ...d, ultima_corrida: corrida }
                         : { vacio: true, ultima_corrida: corrida };
        return json(cuerpo, 200, origin, {
          'Cache-Control': 'public, max-age=120, s-maxage=600',
        });
      }

      if (ruta === '/copernicus.json' && req.method === 'GET') {
        const d = await leerCopernicus(env);
        // Cambia una vez al día como mucho, así que la ventana del edge es
        // larga: la capa pesa más que las otras y no tiene por qué viajar
        // completa en cada visita.
        return json(d || { vacio: true }, 200, origin, {
          'Cache-Control': 'public, max-age=1800, s-maxage=7200',
        });
      }
      if (ruta === '/reporte' && req.method === 'POST') return crearReporte(req, env, origin, ip);
      if (ruta === '/contacto' && req.method === 'POST') return contactar(req, env, origin, ip);
      if (ruta === '/abuso' && req.method === 'POST') return reportarAbuso(req, env, origin, ip);
      if (ruta === '/sugerencia' && req.method === 'POST') return crearSugerencia(req, env, origin, ip);

      const mPriv = ruta.match(/^\/reporte\/([\w-]{4,40})$/);
      if (mPriv && req.method === 'GET') return verReportePrivado(mPriv[1], url, env, origin);

      const mEstado = ruta.match(/^\/reporte\/([\w-]{4,40})\/estado$/);
      if (mEstado && req.method === 'POST') return cambiarEstado(mEstado[1], req, env, origin, ctx);

      if (ruta.startsWith('/admin/')) {
        if (!guardAdmin(req, env)) return json({ error: 'no_autorizado' }, 401, origin);
        if (ruta === '/admin/reportes' && req.method === 'GET') return adminReportes(url, env, origin);
        if (ruta === '/admin/estado' && req.method === 'POST') return adminEstado(req, env, origin, ctx);
        if (ruta === '/admin/sugerencias' && req.method === 'GET') return adminSugerencias(url, env, origin);
        if (ruta === '/admin/sugerencia' && req.method === 'POST') return adminSugerencia(req, env, origin, ctx);
        if (ruta === '/admin/acopios' && req.method === 'POST') {
          const d = await refrescarAcopios(env, { geocodificar: 25 });
          return json({ ok: true, total: d.total, con_punto_propio: d.con_punto_propio,
                        geocodificados_ahora: d.geocodificados_ahora }, 200, origin);
        }
        /* Refresca la lectura de RedAcopio y devuelve los CANDIDATOS a cerrar:
           puntos nuestros que ellos dan por cerrados. No se cierra nada acá —
           la lista es para escribirla en la columna ESTADO REGISTRO de la
           hoja, que es donde el cierre queda con dueño y fecha. */
        if (ruta === '/admin/redacopio' && req.method === 'POST') {
          if (!env.REDACOPIO_URL) return json({ error: 'sin_url_configurada' }, 400, origin);
          const ra = await refrescarRedacopio(env);
          const base = await leerAcopios(env);
          const items = (base.items || []).slice();
          const f = fusionarRedacopio(items, ra.items);
          return json({ ok: true, leidos: ra.total, abiertos: ra.abiertos,
                        cerrados: ra.cerrados, llenos: ra.llenos,
                        enriquecidos: f.enriquecidos, nuevos: f.nuevos,
                        omitidos_cerrados: f.omitidos,
                        candidatos_a_cerrar: f.candidatos }, 200, origin);
        }
        if (ruta === '/admin/necesidades' && req.method === 'POST') {
          const d = await refrescarNecesidades(env, { geocodificar: 15 });
          if (!d) return json({ error: 'sin_hoja_configurada' }, 400, origin);
          return json({ ok: true, total: d.total, con_punto_propio: d.con_punto_propio,
                        geocodificados_ahora: d.geocodificados_ahora,
                        fechas_descartadas: d.fechas_descartadas }, 200, origin);
        }
        if (ruta === '/admin/inteligencia' && req.method === 'POST') {
          try {
            const ag = await recolectarPrensa(env, { origen: 'manual' });
            return json({ ok: true, notas: ag.totales.notas, medios: ag.totales.medios,
                          recoleccion: ag.recoleccion }, 200, origin);
          } catch (e) {
            // Una corrida descartada NO es un 500: hizo lo correcto al no
            // publicar. Se responde con el motivo y el detalle por medio.
            if (e && e.descartada) {
              return json({ ok: false, descartada: true, motivo: e.message, medios: e.diag },
                          200, origin);
            }
            throw e;
          }
        }
        // Bitácora de corridas: qué corrió, cuándo, si publicó y por qué no.
        if (ruta === '/admin/corridas' && req.method === 'GET') {
          const r = await env.DB.prepare(
            `SELECT id, ts, tarea, origen, ok, publicado, ms, notas, medios, detalle
             FROM corridas ORDER BY ts DESC LIMIT 40`
          ).all();
          return json({ corridas: (r.results || []).map((f) => ({
            ...f, detalle: f.detalle ? JSON.parse(f.detalle) : null,
          })) }, 200, origin);
        }
        if (ruta === '/admin/copernicus' && req.method === 'POST') {
          const d = await refrescarCopernicus(env);
          return json({ ok: true, ...d.total, ultima_entrega: d.ultima_entrega,
                        fallos: d.fallos || [] }, 200, origin);
        }
      }

      return json({ error: 'ruta_desconocida' }, 404, origin);
    } catch (err) {
      // Nunca devolver el detalle del error a un endpoint público.
      console.error('error', ruta, err && err.message);
      return json({ error: 'error_interno' }, 500, origin);
    }
  },

  /**
   * Dos ritmos distintos, por lo que mide cada fuente.
   *
   *   cada 3 h  → prensa. Los titulares aparecen y se apagan en horas.
   *   diario    → Copernicus. Entrega uno o dos productos nuevos al día; pedir
   *               su API cada 3 horas sería traer catorce veces lo mismo.
   */
  async scheduled(evento, env, ctx) {

    const diario = evento.cron === CRON_DIARIO;
    // Un horario que no reconocemos es casi siempre una expresión cambiada en
    // `wrangler.toml` y no acá: queda dicho en el log en vez de correr callado
    // la tarea equivocada.
    if (!diario && evento.cron !== CRON_PRENSA) console.warn('cron desconocido', evento.cron);

    if (!diario) {
      // ⚠️⚠️ UN SOLO waitUntil, y las dos tareas EN SERIE. Antes eran dos en
      // paralelo: además de competir por el presupuesto de la invocación,
      // volvía imposible atribuir un fallo. Primero lo que la página publica.
      ctx.waitUntil((async () => {
        try {
          const ag = await recolectarPrensa(env, { origen: 'cron' });
          console.log('prensa', ag.totales.notas, 'notas', ag.totales.medios, 'medios');
        } catch (e) {
          // Una corrida descartada ya quedó anotada en `corridas`; acá solo se
          // registra para el tail en vivo.
          console.error('prensa falló', e && e.message);
        }

        // Los acopios se geocodifican en el cron y no en la visita: cada
        // búsqueda tarda ~1 s y nadie puede esperar eso al abrir el mapa.
        const t0 = Date.now();
        try {
          const d = await refrescarAcopios(env, { geocodificar: 25 });
          if (d) {
            console.log('acopios', d.total, '·', d.geocodificados_ahora, 'geocodificados');
            await anotarCorrida(env, {
              tarea: 'acopios', origen: 'cron', ok: true, publicado: true,
              ms: Date.now() - t0, notas: d.total,
              detalle: { geocodificados: d.geocodificados_ahora, sin_ubicar: d.sin_ubicar },
            });
          }
        } catch (e) {
          console.error('acopios falló', e && e.message);
          await anotarCorrida(env, {
            tarea: 'acopios', origen: 'cron', ok: false, publicado: false,
            ms: Date.now() - t0, detalle: { error: String((e && e.message) || e) },
          });
        }

        /* RedAcopio Bogotá: su lectura va en su propio try y DESPUÉS de los
           acopios. Es la fuente más frágil de todas —se lee de su HTML— así
           que ni puede retrasar ni puede tumbar lo demás. */
        const tRA = Date.now();
        try {
          const d = await refrescarRedacopio(env);
          if (d) {
            console.log('redacopio', d.total, '·', d.cerrados, 'cerrados');
            await anotarCorrida(env, {
              tarea: 'redacopio', origen: 'cron', ok: true, publicado: true,
              ms: Date.now() - tRA, notas: d.total,
              detalle: { abiertos: d.abiertos, cerrados: d.cerrados, llenos: d.llenos },
            });
          }
        } catch (e) {
          // La guarda del módulo tira acá cuando el parseo trae mucho menos de
          // lo normal: se conserva la última copia buena y queda constancia.
          console.error('redacopio falló', e && e.message);
          await anotarCorrida(env, {
            tarea: 'redacopio', origen: 'cron', ok: false, publicado: false,
            ms: Date.now() - tRA, detalle: { error: String((e && e.message) || e) },
          });
        }

        /* Las necesidades van DESPUÉS y en su propio try: si la pestaña nueva
           falla, los acopios ya quedaron refrescados. Se le da menos cupo de
           geocodificación porque son muchas menos filas y comparten el mismo
           límite de una petición por segundo de Nominatim. */
        const t1 = Date.now();
        try {
          const d = await refrescarNecesidades(env, { geocodificar: 10 });
          if (d) {
            console.log('necesidades', d.total, '·', d.geocodificados_ahora, 'geocodificadas');
            await anotarCorrida(env, {
              tarea: 'necesidades', origen: 'cron', ok: true, publicado: true,
              ms: Date.now() - t1, notas: d.total,
              detalle: { geocodificadas: d.geocodificados_ahora, sin_ubicar: d.sin_ubicar,
                         fechas_descartadas: d.fechas_descartadas },
            });
          }
        } catch (e) {
          console.error('necesidades falló', e && e.message);
          await anotarCorrida(env, {
            tarea: 'necesidades', origen: 'cron', ok: false, publicado: false,
            ms: Date.now() - t1, detalle: { error: String((e && e.message) || e) },
          });
        }
      })());
      return;
    }

    ctx.waitUntil(
      refrescarCopernicus(env)
        .then((d) => console.log('copernicus', d.total.destruidos, 'destruidos',
          d.total.danados, 'dañados', d.total.zonas, 'zonas'))
        // Mismo criterio que la prensa: si Copernicus no responde queda la
        // última copia buena. Una capa de daño desactualizada sigue sirviendo;
        // una capa vacía en plena emergencia, no.
        .catch((e) => console.error('copernicus falló', e && e.message))
    );
  },
};
