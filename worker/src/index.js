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
 *   GET  /inteligencia.json       pulso de prensa (lo recolecta el cron, no la visita)
 *   GET  /admin/reportes          moderación (X-Admin-Token)
 *   POST /admin/estado            ocultar / verificar (X-Admin-Token)
 *   POST /admin/inteligencia      forzar una recolección (X-Admin-Token)
 *   GET  /salud                   ping
 */
import { recolectar as recolectarPrensa, leer as leerPrensa } from './inteligencia.js';
import { leer as leerAcopios, refrescar as refrescarAcopios } from './acopios.js';

const ORIGENES = [
  'https://sismo.ricardoruiz.co',
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
  'nec-otro':        { tipo:'necesito', cat:'otro' },

  // Haber encontrado a una persona desorientada o herida NO admite foto:
  // publicar la imagen de alguien que no puede consentir es un problema de
  // dignidad, y para reencontrarla basta la descripción y el lugar.
  'ofr-persona':     { tipo:'ofrezco',  cat:'persona',     priv:true },
  'ofr-mascota':     { tipo:'ofrezco',  cat:'mascota',                foto:true },
  'ofr-alojamiento': { tipo:'ofrezco',  cat:'refugio' },
  'ofr-viveres':     { tipo:'ofrezco',  cat:'viveres' },
  'ofr-salud':       { tipo:'ofrezco',  cat:'salud' },
  'ofr-transporte':  { tipo:'ofrezco',  cat:'transporte' },
  'ofr-voluntario':  { tipo:'ofrezco',  cat:'rescate' },
  'ofr-otro':        { tipo:'ofrezco',  cat:'otro' },
};

const URGENCIAS = new Set(['alta', 'media', 'baja']);
const ESTADOS = new Set(['activo', 'resuelto', 'oculto']);

const LIMITES = { reportesPorHora: 5, mensajesPorHora: 20, abusosPorHora: 30 };

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
 * Se aplica a TODO reporte cuyo contacto no sea público.
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

async function bajoLimite(env, tabla, ipHash, max) {
  const desde = Date.now() - 3600_000;
  const q = tabla === 'mensajes'
    ? 'SELECT COUNT(*) AS n FROM mensajes WHERE ip_hash = ? AND ts > ?'
    : 'SELECT COUNT(*) AS n FROM reportes WHERE ip_hash = ? AND ts > ?';
  const row = await env.DB.prepare(q).bind(ipHash, desde).first();
  return (row?.n || 0) < max;
}

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
    d: r.contacto_pub ? r.detalle : enmascarar(r.detalle),
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
    caps: { fotos: !!env.FOTOS },
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
      id: r.id, ts: r.ts, tipo: r.tipo, cat: r.cat, urgencia: r.urgencia,
      titulo: r.titulo, detalle: r.detalle, ciudad: r.ciudad, barrio: r.barrio,
      lat: r.lat, lon: r.lon, estado: r.estado, contacto: r.contacto,
      contacto_pub: r.contacto_pub,
    },
    mensajes: results || [],
  }, 200, origin);
}

async function cambiarEstado(id, req, env, origin) {
  let b; try { b = await req.json(); } catch { return json({ error: 'json_invalido' }, 400, origin); }
  const estado = ESTADOS.has(b.estado) ? b.estado : null;
  if (!estado || estado === 'oculto') return json({ error: 'estado_invalido' }, 400, origin);

  const r = await env.DB.prepare('SELECT token FROM reportes WHERE id = ?').bind(id).first();
  if (!r) return json({ error: 'no_existe' }, 404, origin);
  if (!b.token || b.token !== r.token) return json({ error: 'token_invalido' }, 403, origin);

  await env.DB.prepare('UPDATE reportes SET estado = ?, actualizado = ? WHERE id = ?')
    .bind(estado, Date.now(), id).run();
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
    const base = env.SITIO || 'https://sismo.ricardoruiz.co';
    await avisarPorCorreo(env, r.contacto,
      'Tienes un mensaje nuevo sobre tu reporte',
      `<p>Alguien respondió a tu reporte <strong>${r.titulo}</strong>.</p>
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

  const { results } = await env.DB.prepare(`
    SELECT id, ts, tipo, cat, urgencia, titulo, detalle, ciudad, barrio, personas,
           lat, lon, contacto, contacto_pub, estado, abusos, sin_captcha, verificado
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
        const d = await leerAcopios(env);
        return json(d, 200, origin, {
          // Se edita en vivo, así que la ventana es corta; aun así el edge
          // absorbe el grueso y Google no ve una petición por visitante.
          'Cache-Control': 'public, max-age=60, s-maxage=300',
        });
      }

      if (ruta === '/inteligencia.json' && req.method === 'GET') {
        const d = await leerPrensa(env);
        // Todavía sin corrida del cron: se responde 200 con `vacio`, no un
        // error, para que la página muestre "aún no hay lectura" en vez de
        // parecer rota.
        return json(d || { vacio: true }, 200, origin, {
          'Cache-Control': 'public, max-age=120, s-maxage=600',
        });
      }
      if (ruta === '/reporte' && req.method === 'POST') return crearReporte(req, env, origin, ip);
      if (ruta === '/contacto' && req.method === 'POST') return contactar(req, env, origin, ip);
      if (ruta === '/abuso' && req.method === 'POST') return reportarAbuso(req, env, origin, ip);

      const mPriv = ruta.match(/^\/reporte\/([\w-]{4,40})$/);
      if (mPriv && req.method === 'GET') return verReportePrivado(mPriv[1], url, env, origin);

      const mEstado = ruta.match(/^\/reporte\/([\w-]{4,40})\/estado$/);
      if (mEstado && req.method === 'POST') return cambiarEstado(mEstado[1], req, env, origin);

      if (ruta.startsWith('/admin/')) {
        if (!guardAdmin(req, env)) return json({ error: 'no_autorizado' }, 401, origin);
        if (ruta === '/admin/reportes' && req.method === 'GET') return adminReportes(url, env, origin);
        if (ruta === '/admin/estado' && req.method === 'POST') return adminEstado(req, env, origin, ctx);
        if (ruta === '/admin/acopios' && req.method === 'POST') {
          const d = await refrescarAcopios(env, { geocodificar: 25 });
          return json({ ok: true, total: d.total, con_punto_propio: d.con_punto_propio,
                        geocodificados_ahora: d.geocodificados_ahora }, 200, origin);
        }
        if (ruta === '/admin/inteligencia' && req.method === 'POST') {
          const ag = await recolectarPrensa(env);
          return json({ ok: true, notas: ag.totales.notas, medios: ag.totales.medios }, 200, origin);
        }
      }

      return json({ error: 'ruta_desconocida' }, 404, origin);
    } catch (err) {
      // Nunca devolver el detalle del error a un endpoint público.
      console.error('error', ruta, err && err.message);
      return json({ error: 'error_interno' }, 500, origin);
    }
  },

  /** Cron cada 3 horas: recolecta el pulso de prensa fuera de la visita. */
  async scheduled(evento, env, ctx) {
    // Los acopios se geocodifican en el cron y no en la visita: cada búsqueda
    // tarda ~1 s y nadie puede esperar eso al abrir el mapa.
    ctx.waitUntil(
      refrescarAcopios(env, { geocodificar: 25 })
        .then((d) => d && console.log('acopios', d.total, '·', d.geocodificados_ahora, 'geocodificados'))
        .catch((e) => console.error('acopios falló', e && e.message))
    );
    ctx.waitUntil(
      recolectarPrensa(env)
        .then((ag) => console.log('prensa', ag.totales.notas, 'notas',
          ag.totales.medios, 'medios'))
        // Si Google News falla, queda publicada la corrida anterior. Nunca se
        // borra lo bueno por una recolección mala.
        .catch((e) => console.error('prensa falló', e && e.message))
    );
  },
};
