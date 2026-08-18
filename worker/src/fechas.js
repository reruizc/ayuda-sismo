/**
 * Fechas sueltas dentro de un horario escrito a mano.
 *
 * ⚠️⚠️ Un horario con fecha VENCE, y publicarlo como si siguiera vigente es de
 * lo peor que puede hacer este mapa. Medido el 18 de agosto: PARQUE LA COLINA
 * decía "Abierto hasta hoy Lunes 17 de agosto a las 7pm. Después suspende
 * operación" — o sea, el propio texto avisaba que ya había cerrado, y la ficha
 * lo mostraba bajo el rótulo "Horario", que se lee como "está abierto así".
 * Alguien carga el carro, maneja dos horas y encuentra una puerta cerrada.
 *
 * Esto NO borra el punto del mapa: saca el horario vencido del campo de
 * horario y lo deja aparte, rotulado con su fecha, que es información útil
 * (dice que probablemente cerró) siempre que no se disfrace de vigente. Borrar
 * el punto por inferencia sobre un texto libre es demasiado poder para un
 * parser — mismo criterio que ya rige para los "cerrado" de RedAcopio.
 */

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};
// Los nombres largos primero: si no, `abr` gana sobre `abril` y se come la "il".
const NOM_MES = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');

/**
 * "17 de agosto", "16 agosto", "20 ago".
 * ⚠️ El `(?<![\d:])` evita que la hora se lea como día: en "8:17 de agosto"
 * el 17 viene de un reloj, no del calendario.
 */
const RE_DIA_MES = new RegExp(`(?<![\\d:])(\\d{1,2})\\s*(?:de\\s+)?(${NOM_MES})\\b`, 'gi');

/**
 * "viernes 14", "lunes 17 de 3pm a 8pm" — día de semana seguido de número, sin mes.
 *
 * ⚠️⚠️ El descarte del final es lo que separa una fecha de un horario que se
 * repite: "Martes 11:00 a.m." y "Lunes 9:00 a.m." NO son fechas, son el día en
 * que ese sitio atiende, y marcarlos vencidos borraría el horario de un acopio
 * que opera. Si al número le sigue un reloj (`:`) o am/pm, no es un día del mes.
 */
const RE_SEMANA_DIA =
  /(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\s+(?:el\s+|de\s+)?(\d{1,2})(?![\d:]|\s*[ap]\.?\s*m)/gi;

const desTilde = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** El día de hoy en Colombia. El Worker corre en UTC y acá son cinco horas menos. */
export function hoyBogota(ahora = Date.now()) {
  const d = new Date(ahora - 5 * 3600 * 1000);
  return { a: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

const num = (f) => f.a * 10000 + f.m * 100 + f.d;

/** La fecha MÁS TARDÍA que menciona el texto, o null si no menciona ninguna. */
export function fechaTope(txt, hoy = hoyBogota()) {
  const t = desTilde(txt);
  if (!t) return null;

  const cand = [];
  for (const m of t.matchAll(RE_DIA_MES)) {
    const dia = +m[1], mes = MESES[desTilde(m[2]).toLowerCase()];
    if (mes && dia >= 1 && dia <= 31) cand.push({ dia, mes });
  }
  for (const m of t.matchAll(RE_SEMANA_DIA)) {
    const dia = +m[1];
    if (dia >= 1 && dia <= 31) cand.push({ dia, mes: null });
  }
  if (!cand.length) return null;

  let mejor = null;
  for (const c of cand) {
    let mes = c.mes, anio = hoy.a;
    if (mes == null) {
      // Sin mes se asume el corriente; si eso cae muy adelante, es el pasado
      // (un "viernes 30" escrito el 2 del mes siguiente).
      mes = hoy.m;
      if (num({ a: anio, m: mes, d: c.dia }) - num(hoy) > 20) {
        mes--; if (mes < 1) { mes = 12; anio--; }
      }
    }
    let f = { a: anio, m: mes, d: c.dia };
    // Diciembre escrito en enero: el año es el anterior, no el que viene.
    if (num(f) - num(hoy) > 6000) f = { a: anio - 1, m: mes, d: c.dia };
    if (!mejor || num(f) > num(mejor)) mejor = f;
  }
  return mejor;
}

/** ¿La última fecha que menciona el texto ya pasó? Sin fecha, nunca vence. */
export function vencido(txt, hoy = hoyBogota()) {
  const f = fechaTope(txt, hoy);
  return f ? num(f) < num(hoy) : false;
}

const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "17 de agosto", para rotular el aviso vencido con su fecha. */
export function fechaCorta(f) {
  return f ? `${f.d} de ${NOMBRE_MES[f.m - 1]}` : '';
}

/**
 * Fecha de la hoja a ISO.
 *
 * Google exporta `8/14/2026` (mes primero) y a veces el número de serie de la
 * hoja. Lo que no se lea como fecha cierta no se publica: `13/8/2026` sale vacío.
 */
const EPOCA_SHEETS = Date.UTC(1899, 11, 30);
const DIA_MS = 86400000;
const ANIO_MIN = 2000;
const ANIO_MAX = 2100;

const armarISO = (a, m, d) => {
  if (!(a >= ANIO_MIN && a <= ANIO_MAX)) return '';
  const t = new Date(Date.UTC(a, m - 1, d));
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export function fechaISO(txt) {
  const s = String(txt ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return armarISO(+iso[1], +iso[2], +iso[3]);

  const mesPrimero = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (mesPrimero) return armarISO(+mesPrimero[3], +mesPrimero[1], +mesPrimero[2]);

  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const f = new Date(EPOCA_SHEETS + Math.floor(Number(s)) * DIA_MS);
    if (!Number.isFinite(f.getTime())) return '';
    return armarISO(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  return '';
}
