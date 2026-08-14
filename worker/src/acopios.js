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
    let la = Number(g(f, ix.lat));
    let lo = Number(g(f, ix.lon));
    let aprox = false;
    let dep = g(f, ix.depto);

    if (!Number.isFinite(la) || !Number.isFinite(lo) || la === 0 || lo === 0) {
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
      n: nombre,
      mu: muni,
      dp: dep,
      d: g(f, ix.direccion),
      ne: g(f, ix.necesidad),
      h: [abre, cierra].filter(Boolean).join(' a ') || '',
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

export async function refrescar(env) {
  const url = env.ACOPIOS_CSV;
  if (!url) return null;

  const r = await fetch(url, {
    headers: { 'User-Agent': 'MapaDeAyuda/1.0 (+https://sismo.ricardoruiz.co)' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`hoja http ${r.status}`);
  const txt = await r.text();

  // Si Google devuelve una página de login o de error, llega HTML y no CSV.
  // Guardar eso pisaría la última copia buena con basura.
  if (/^\s*<(!doctype|html)/i.test(txt)) throw new Error('la hoja no es pública');

  const { items, sin_ubicar, error } = normalizarFilas(parsearCSV(txt));
  if (error) throw new Error(error);

  const datos = {
    generado: Date.now(),
    total: items.length,
    sin_ubicar,
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
