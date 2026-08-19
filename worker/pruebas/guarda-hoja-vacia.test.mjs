import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { refrescar as refrescarAcopios, leer as leerAcopios, GUARDA_ACOPIOS } from '../src/acopios.js';
import { refrescar as refrescarNecesidades, GUARDA_NECESIDADES } from '../src/necesidades.js';

const HORA = 60 * 60 * 1000;
const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

function entorno({ cuerpo, guardado = null }) {
  let fila = guardado ? { datos: JSON.stringify(guardado) } : null;
  const escrituras = [];
  const DB = {
    prepare(sql) {
      const q = { args: [] };
      q.bind = (...a) => { q.args = a; return q; };
      q.first = async () => (sql.includes('FROM externos') ? fila : null);
      q.all = async () => ({ results: [] });
      q.run = async () => {
        escrituras.push(sql);
        if (sql.includes('INSERT INTO externos')) fila = { datos: q.args[1] };
        return { success: true };
      };
      return q;
    },
  };
  globalThis.fetch = async () => new Response(cuerpo, { status: 200 });
  return {
    env: { DB, ACOPIOS_CSV: 'https://hoja/acopios', NECESIDADES_CSV: 'https://hoja/necesidades' },
    guardoEnExternos: () => escrituras.some((s) => s.includes('INSERT INTO externos')),
  };
}

const copiaBuena = (total, edadMs = 0) => ({
  generado: Date.now() - edadMs,
  total,
  items: Array.from({ length: total }, (_, i) => ({ k: 'k' + i, n: 'PUNTO ' + i })),
});

const CABECERA_AC = 'NOMBRE,CIUDAD O MUNICIPIO,DEPARTAMENTO,DIRECCION,LATITUD,LONGITUD,ESTADO REGISTRO';
const filaAc = (nombre, via, estado) =>
  nombre + ',Bogotá,Bogotá D.C.,' + via + ',4.65,-74.08,' + estado;
const hojaAcopios = (cuantas) => [CABECERA_AC,
  ...Array.from({ length: cuantas }, (_, i) => filaAc('ACOPIO ' + i, 'Calle ' + i, ''))].join('\n');

const CABECERA_NE = 'NOMBRE,TIPO,NECESIDAD,FECHA DE LA NECESIDAD,DIRECCIÓN,CONTACTO,MUNICIPIO,DEPARTAMENTO,FUENTE,LATITUD,LONGITUD';
const filaNe = (nombre, necesidad, direccion) =>
  nombre + ',ONG,' + necesidad + ',,' + direccion + ',,Bogotá,Bogotá D.C.,,4.65,-74.08';
const hojaNecesidades = (cuantas) => [CABECERA_NE,
  ...Array.from({ length: cuantas },
    (_, i) => filaNe('ORG ' + i, 'Alimentos', 'Calle ' + i + ' # 2 - 30'))].join('\n');

const ERROR_GOOGLE = '<!DOCTYPE html><html lang="es"><head><title>Error</title></head>'
  + '<body>Lo sentimos, no se ha podido abrir el archivo.</body></html>';
const ERROR_GOOGLE_SIN_DOCTYPE = '<meta charset="utf-8"><title>Error 401</title>'
  + '<p>Se necesita autorización para ver este archivo.</p>';

test('una hoja vacía con estado 200 no borra los acopios del mapa', async () => {
  const { env, guardoEnExternos } = entorno({ cuerpo: CABECERA_AC + '\n', guardado: copiaBuena(280) });

  const d = await refrescarAcopios(env);

  assert.equal(d.total, 280, 'el refresco vacío pisó la copia buena');
  assert.equal(d.items.length, 280);
  assert.deepEqual(d.refresco_descartado, { traidos: 0, minimo_exigido: 140, publicados_antes: 280 });
  assert.equal(guardoEnExternos(), false, 'se escribió la copia vacía en la base');
});

test('una hoja con una sola fila tampoco los borra', async () => {
  const { env, guardoEnExternos } = entorno({ cuerpo: hojaAcopios(1), guardado: copiaBuena(280) });

  const d = await refrescarAcopios(env);

  assert.equal(d.total, 280);
  assert.equal(d.refresco_descartado.traidos, 1);
  assert.equal(guardoEnExternos(), false);
});

test('la hoja completa se publica igual que siempre, sin marca de guarda', async () => {
  const { env, guardoEnExternos } = entorno({ cuerpo: hojaAcopios(280), guardado: copiaBuena(280) });

  const d = await refrescarAcopios(env);

  assert.equal(d.total, 280);
  assert.equal(d.refresco_descartado, undefined, 'la guarda bloqueó un refresco sano');
  assert.equal(d.encogimiento_aceptado, undefined);
  assert.equal(guardoEnExternos(), true);
});

test('el arranque en frío publica lo que haya, aunque sean tres puntos', async () => {
  const { env, guardoEnExternos } = entorno({ cuerpo: hojaAcopios(3), guardado: null });

  const d = await refrescarAcopios(env);

  assert.equal(d.total, 3, 'la guarda bloqueó el arranque en frío');
  assert.equal(d.refresco_descartado, undefined);
  assert.equal(guardoEnExternos(), true);
});

test('un encogimiento se conserva mientras la copia buena siga fresca', async () => {
  const { env, guardoEnExternos } = entorno({
    cuerpo: hojaAcopios(100), guardado: copiaBuena(280, 1 * HORA),
  });

  const d = await refrescarAcopios(env);

  assert.equal(d.total, 280);
  assert.deepEqual(d.refresco_descartado, { traidos: 100, minimo_exigido: 140, publicados_antes: 280 });
  assert.equal(guardoEnExternos(), false);
});

test('pasada la gracia el encogimiento se acepta y queda anotado', async () => {
  const { env, guardoEnExternos } = entorno({
    cuerpo: hojaAcopios(100),
    guardado: copiaBuena(280, GUARDA_ACOPIOS.graciaAntesDeAceptarMs + HORA),
  });

  const d = await refrescarAcopios(env);

  assert.equal(d.total, 100, 'la guarda quedó trabada con datos viejos');
  assert.deepEqual(d.encogimiento_aceptado, { traidos: 100, minimo_exigido: 140, publicados_antes: 280 });
  assert.equal(guardoEnExternos(), true);
});

test('el cero no se publica ni con la gracia vencida', async () => {
  const { env, guardoEnExternos } = entorno({
    cuerpo: CABECERA_AC + '\n', guardado: copiaBuena(280, 30 * 24 * HORA),
  });

  const d = await refrescarAcopios(env);

  assert.equal(d.total, 280);
  assert.equal(d.refresco_descartado.traidos, 0);
  assert.equal(guardoEnExternos(), false);
});

test('la página de error de Google con estado 200 no pisa la copia buena', async () => {
  for (const cuerpo of [ERROR_GOOGLE, ERROR_GOOGLE_SIN_DOCTYPE]) {
    const { env, guardoEnExternos } = entorno({ cuerpo, guardado: copiaBuena(280) });

    const d = await leerAcopios(env, 0);

    assert.equal(d.total, 280, 'el HTML de Google borró el mapa: ' + cuerpo.slice(0, 24));
    assert.equal(d.items.length, 280);
    assert.equal(guardoEnExternos(), false);
  }
});

test('la guarda cuenta acopios publicables, no filas crudas de la hoja', async () => {
  const filas = [CABECERA_AC,
    ...Array.from({ length: 190 }, (_, i) => filaAc('CERRADO ' + i, 'Calle ' + i, 'cerrado')),
    ...Array.from({ length: 10 }, (_, i) => filaAc('ABIERTO ' + i, 'Carrera ' + i, ''))].join('\n');
  const { env, guardoEnExternos } = entorno({ cuerpo: filas, guardado: copiaBuena(100) });

  const d = await refrescarAcopios(env);

  assert.equal(d.refresco_descartado.traidos, 10, 'la guarda comparó las 200 filas crudas');
  assert.equal(d.total, 100);
  assert.equal(guardoEnExternos(), false);
});

test('la pestaña de necesidades vacía con estado 200 conserva las anteriores', async () => {
  const { env, guardoEnExternos } = entorno({ cuerpo: CABECERA_NE + '\n', guardado: copiaBuena(16) });

  const d = await refrescarNecesidades(env);

  assert.equal(d.total, 16);
  assert.deepEqual(d.refresco_descartado, { traidos: 0, minimo_exigido: 6, publicados_antes: 16 });
  assert.equal(guardoEnExternos(), false);
});

test('la hoja de necesidades completa no se bloquea', async () => {
  const { env, guardoEnExternos } = entorno({ cuerpo: hojaNecesidades(16), guardado: copiaBuena(16) });

  const d = await refrescarNecesidades(env);

  assert.equal(d.total, 16);
  assert.equal(d.refresco_descartado, undefined, 'la guarda bloqueó las 16 necesidades reales');
  assert.equal(guardoEnExternos(), true);
});

test('las necesidades arrancan en frío con las pocas que traiga la hoja', async () => {
  const { env, guardoEnExternos } = entorno({ cuerpo: hojaNecesidades(2), guardado: null });

  const d = await refrescarNecesidades(env);

  assert.equal(d.total, 2);
  assert.equal(guardoEnExternos(), true);
});

test('la guarda de necesidades cuenta sedes, no filas de la hoja', async () => {
  const filas = [CABECERA_NE,
    ...Array.from({ length: 30 }, (_, i) => filaNe('ORG A', 'Alimentos ' + i, 'Calle 1 # 2 - ' + i)),
    ...Array.from({ length: 30 }, (_, i) => filaNe('ORG B', 'Cobijas ' + i, 'Calle 3 # 4 - ' + i))].join('\n');
  const { env, guardoEnExternos } = entorno({ cuerpo: filas, guardado: copiaBuena(16) });

  const d = await refrescarNecesidades(env);

  assert.equal(d.refresco_descartado.traidos, 2, 'la guarda comparó las 60 filas crudas');
  assert.equal(d.total, 16);
  assert.equal(guardoEnExternos(), false);
});

test('pasada la gracia las necesidades encogidas se publican', async () => {
  const { env } = entorno({
    cuerpo: hojaNecesidades(3),
    guardado: copiaBuena(16, GUARDA_NECESIDADES.graciaAntesDeAceptarMs + HORA),
  });

  const d = await refrescarNecesidades(env);

  assert.equal(d.total, 3);
  assert.deepEqual(d.encogimiento_aceptado, { traidos: 3, minimo_exigido: 6, publicados_antes: 16 });
});
