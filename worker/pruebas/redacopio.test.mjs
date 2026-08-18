import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionar } from '../src/redacopio.js';

test('un cierre curado a mano no vuelve al mapa como pin abierto', () => {
  const nuestros = [];
  const suyos = [{ n: 'PARQUE LA COLINA', la: 4.7326369, lo: -74.0687855,
                   estado: 'abierto', ra_id: 'ra-colina' }];
  const retirados = [{ nombre: 'PARQUE LA COLINA', lat: 4.732516, lon: -74.065488 }];

  const res = fusionar(nuestros, suyos, retirados);

  assert.equal(res.nuevos, 0, 'RedAcopio reintrodujo un cierre de la hoja');
  assert.equal(res.no_repuestos, 1);
  assert.equal(nuestros.length, 0);
});

test('a menos de 150 m la distancia sola basta, sin ninguna palabra en común', () => {
  const nuestros = [];
  const suyos = [{ n: 'Punto de acopio Movistar Arena', la: 4.647900, lo: -74.077400,
                   estado: 'abierto', ra_id: 'ra-arena' }];
  const retirados = [{ nombre: 'Coliseo El Campín - Puerta 3', lat: 4.648620, lon: -74.077400 }];

  const res = fusionar(nuestros, suyos, retirados);

  assert.equal(res.nuevos, 0, 'a 80 m es el mismo predio y el nombre no debería hacer falta');
  assert.equal(res.no_repuestos, 1);
});

test('a 163 m, apenas pasado el corte de la distancia sola, el nombre lo sostiene', () => {
  const nuestros = [];
  const suyos = [{ n: 'Vive Claro', la: 4.650614, lo: -74.097558,
                   estado: 'abierto', ra_id: 'ra-viveclaro' }];
  const retirados = [{ nombre: 'VIVE CLARO - PUERTA 10', lat: 4.649151, lon: -74.097554 }];

  const res = fusionar(nuestros, suyos, retirados);

  assert.equal(res.nuevos, 0, 'el corte de 150 m se comió un cierre que el nombre confirma');
  assert.equal(res.no_repuestos, 1);
});

test('a 286 m una sola palabra distintiva en común alcanza para no reponerlo', () => {
  const nuestros = [];
  const suyos = [{ n: 'Parque Logístico Interpark - Siberia', la: 4.768087, lo: -74.176436,
                   estado: 'abierto', ra_id: 'ra-siberia' }];
  const retirados = [{ nombre: 'FUNZA Interpark -', lat: 4.7680871, lon: -74.173856 }];

  const res = fusionar(nuestros, suyos, retirados);

  assert.equal(res.nuevos, 0, 'el mismo predio, con "Interpark" en los dos nombres, entró como punto nuevo');
  assert.equal(res.no_repuestos, 1);
});

test('un punto abierto a 221 m y sin ninguna palabra en común NO se suprime', () => {
  const nuestros = [];
  const suyos = [{ n: 'ZONA T', la: 4.6687318, lo: -74.0574266,
                   estado: 'abierto', ra_id: 'ra-zonat' }];
  const retirados = [{ nombre: 'Carulla 85 - somos.70veces7', lat: 4.669805, lon: -74.055749 }];

  const res = fusionar(nuestros, suyos, retirados);

  assert.equal(res.nuevos, 1,
    'la distancia sola escondió un acopio abierto: en esa zona de Bogotá 221 m son dos direcciones distintas');
  assert.equal(res.no_repuestos, 0);
});

test('un punto ajeno cerca de un cierre sí se publica', () => {
  const nuestros = [];
  const suyos = [{ n: 'Diagonal 54 # 24 -46', la: 4.642205, lo: -74.06776,
                   estado: 'abierto', ra_id: 'ra-diagonal' }];
  const retirados = [{ nombre: 'CASA MAFAPO', lat: 4.646343, lon: -74.070997 }];

  const res = fusionar(nuestros, suyos, retirados);

  assert.equal(res.nuevos, 1, 'se escondió un punto que sí opera');
  assert.equal(res.no_repuestos, 0);
});

test('un retirado sin ubicación no suprime nada por parecido de nombre', () => {
  const nuestros = [];
  const suyos = [{ n: 'CASA MAFAPO', la: 4.646343, lo: -74.070997,
                   estado: 'abierto', ra_id: 'ra-mafapo' }];
  const retirados = [{ nombre: 'CASA MAFAPO', lat: null, lon: null }];

  const res = fusionar(nuestros, suyos, retirados);

  assert.equal(res.nuevos, 1);
  assert.equal(res.no_repuestos, 0);
});
