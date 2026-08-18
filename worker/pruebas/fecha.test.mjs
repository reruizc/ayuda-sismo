import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarFilas } from '../src/acopios.js';
import { fechaISO } from '../src/fechas.js';

test('la hoja escribe el mes primero y sale en ISO sin correr el día', () => {
  assert.equal(fechaISO('8/14/2026'), '2026-08-14');
  assert.equal(fechaISO('8/12/2026'), '2026-08-12');
  assert.equal(fechaISO('12/31/2026'), '2026-12-31');
});

test('una fecha que ya viene en ISO queda igual', () => {
  assert.equal(fechaISO('2026-08-14'), '2026-08-14');
});

test('el número de serie de Sheets se convierte con la época de la hoja', () => {
  assert.equal(fechaISO('46249'), '2026-08-15');
});

test('lo que no es una fecha cierta no se publica', () => {
  const basura = ['', '   ', 'ayer', 'Invalid Date', '2026', '0', '3001234567',
                  '2/30/2026', '13/13/2026', '1/1/0001'];
  for (const v of basura) {
    assert.equal(fechaISO(v), '', 'no debería publicar ' + JSON.stringify(v));
  }
});

test('si la hoja invirtiera el orden, los días 13 a 31 desaparecen en vez de mentir', () => {
  assert.equal(fechaISO('13/8/2026'), '');
  assert.equal(fechaISO('31/12/2026'), '');
});

test('la fila llega al mapa con la fecha en ISO, y sin fecha si no se puede leer', () => {
  const { items } = normalizarFilas([
    ['NOMBRE', 'CIUDAD O MUNICIPIO', 'VERIFICADO', 'FECHA ULTIMA VERIFICACION'],
    ['VIVE CLARO', 'Bogotá', 'si', '8/14/2026'],
    ['PARQUE LA COLINA', 'Bogotá', 'si', '2/30/2026'],
  ]);

  assert.equal(items[0].rev, '2026-08-14');
  assert.equal(items[1].rev, '');
});
