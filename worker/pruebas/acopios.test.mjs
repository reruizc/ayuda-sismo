import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarFilas } from '../src/acopios.js';

const CABECERA = ['NOMBRE', 'CIUDAD O MUNICIPIO', 'DEPARTAMENTO', 'LATITUD', 'LONGITUD',
                  'ESTADO REGISTRO'];

test('una fila cerrada sale de items y entra a retirados con su ubicación', () => {
  const { items, retirados, ocultos } = normalizarFilas([
    CABECERA,
    ['PARQUE LA COLINA', 'Bogotá', 'Bogotá D.C.', '4.732516', '-74.065488', 'cerrado'],
    ['VIVE CLARO', 'Bogotá', 'Bogotá D.C.', '4.649151', '-74.097554', 'por_verificar'],
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].n, 'VIVE CLARO');
  assert.equal(ocultos, 1);
  assert.deepEqual(retirados, [{ nombre: 'PARQUE LA COLINA', lat: 4.732516, lon: -74.065488 }]);
});

test('una fila cerrada sin coordenada se retira con el centro del municipio', () => {
  const { items, retirados } = normalizarFilas([
    CABECERA,
    ['CASA DE LA MEMORIA', 'Bogotá', 'Bogotá D.C.', '', '', 'descartado'],
  ]);

  assert.equal(items.length, 0);
  assert.equal(retirados.length, 1);
  assert.equal(retirados[0].nombre, 'CASA DE LA MEMORIA');
  assert.ok(retirados[0].lat != null && retirados[0].lon != null,
            'la fila retirada se quedó sin ubicación pudiendo tener centroide');
});
