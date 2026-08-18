import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coordenadaDeRelleno,
  direccionColombiana,
  geocodificarNombreConfirmandoDireccion,
  conCoordenadaConfiable,
} from '../src/acopios.js';

const CENTRO_BOGOTA = [4.62141, -74.11125];
const RELLENO = { la: 4.655, lo: -74.11 };

const LOS_CUATRO = [
  { n: 'Asoreway', d: 'KR 96#41-19 SUR' },
  { n: 'Fundación Bajo Cuerda - Bogotá', d: 'Cll 74a#22-11' },
  { n: 'Teatro Libre Chapinero', d: 'Calle 62 No. 9A-65' },
  { n: 'Fundación Orca', d: 'CALLE 41 #72-24' },
];

const dbSinCache = {
  prepare: () => ({
    all: async () => ({ results: [] }),
    bind: () => ({ run: async () => {} }),
  }),
};

function conRespuesta(cuerpo, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(cuerpo), {
    headers: { 'content-type': 'application/json' },
  });
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = real; });
}

const respuestaBuena = {
  lat: '4.6483169',
  lon: '-74.0627025',
  place_rank: 30,
  type: 'theatre',
  address: {
    amenity: 'Teatro Libre', house_number: '9A-84', road: 'Calle 62',
    suburb: 'Localidad Chapinero', city: 'Bogotá', country_code: 'co',
  },
};

test('la coordenada de relleno no cuenta como ubicación', () => {
  assert.equal(coordenadaDeRelleno(4.655, -74.11), true);
  assert.equal(coordenadaDeRelleno(null, null), true);
  assert.equal(coordenadaDeRelleno(0, 0), true);
  assert.equal(coordenadaDeRelleno(4.6483169, -74.0627025), false);
  assert.equal(coordenadaDeRelleno(4.7326, -74.0687), false);
});

test('las cuatro direcciones se leen como vía y cruce', () => {
  assert.deepEqual(direccionColombiana('KR 96#41-19 SUR'), { via: 'carrera 96', cruce: '41' });
  assert.deepEqual(direccionColombiana('Cll 74a#22-11'), { via: 'calle 74a', cruce: '22' });
  assert.deepEqual(direccionColombiana('Calle 62 No. 9A-65'), { via: 'calle 62', cruce: '9a' });
  assert.deepEqual(direccionColombiana('CALLE 41 #72-24'), { via: 'calle 41', cruce: '72' });
});

test('una dirección que no dice nada no produce coordenada', async () => {
  assert.equal(direccionColombiana(''), null);
  assert.equal(direccionColombiana('atrás del parque'), null);
  assert.equal(direccionColombiana('asdfgh'), null);
  const r = await geocodificarNombreConfirmandoDireccion(
    'Teatro Libre Chapinero', 'Bogotá', 'atrás del parque', CENTRO_BOGOTA);
  assert.equal(r, null, 'geocodificó sin una dirección con qué contrastar');
});

test('la coordenada de relleno también se rechaza cuando la devuelve el servicio', async () => {
  await conRespuesta([{ ...respuestaBuena, lat: '4.655', lon: '-74.11' }], async () => {
    const r = await geocodificarNombreConfirmandoDireccion(
      'Teatro Libre Chapinero', 'Bogotá', 'Calle 62 No. 9A-65', CENTRO_BOGOTA);
    assert.equal(r, null, 'se cambió un punto falso por otro punto falso');
  });
});

test('una respuesta a nivel de ciudad no dice a dónde ir', async () => {
  await conRespuesta([{ ...respuestaBuena, place_rank: 16, type: 'city' }], async () => {
    const r = await geocodificarNombreConfirmandoDireccion(
      'Teatro Libre Chapinero', 'Bogotá', 'Calle 62 No. 9A-65', CENTRO_BOGOTA);
    assert.equal(r, null, 'publicó el centro de la ciudad como si fuera la puerta');
  });
});

test('un tramo de vía no se publica aunque la vía sea la correcta', async () => {
  await conRespuesta([{
    lat: '4.6460610', lon: '-74.0966020', place_rank: 26, type: 'residential',
    address: { road: 'Calle 41', city: 'Bogotá', country_code: 'co' },
  }], async () => {
    const r = await geocodificarNombreConfirmandoDireccion(
      'Fundación Orca', 'Bogotá', 'CALLE 41 #72-24', CENTRO_BOGOTA);
    assert.equal(r, null, 'publicó un punto arbitrario de la vía como si fuera la placa');
  });
});

test('un resultado en otro municipio no se publica', async () => {
  await conRespuesta([{
    lat: '4.5731190', lon: '-74.1766570', place_rank: 30, type: 'theatre',
    address: { road: 'Calle 41', town: 'Soacha ciudad', country_code: 'co' },
  }], async () => {
    const r = await geocodificarNombreConfirmandoDireccion(
      'Fundación Orca', 'Bogotá', 'CALLE 41 #72-24', CENTRO_BOGOTA);
    assert.equal(r, null, 'mandó gente a otro municipio');
  });
});

test('un sitio en otra vía que la del registro no se publica', async () => {
  await conRespuesta([{
    ...respuestaBuena,
    address: { ...respuestaBuena.address, road: 'Calle 80', house_number: '13-05' },
  }], async () => {
    const r = await geocodificarNombreConfirmandoDireccion(
      'Teatro Libre Chapinero', 'Bogotá', 'Calle 62 No. 9A-65', CENTRO_BOGOTA);
    assert.equal(r, null, 'la dirección no confirmó el punto y aun así salió');
  });
});

test('un sitio en la vía correcta pero en el cruce equivocado no se publica', async () => {
  await conRespuesta([{
    ...respuestaBuena,
    address: { ...respuestaBuena.address, house_number: '68-40' },
  }], async () => {
    const r = await geocodificarNombreConfirmandoDireccion(
      'Teatro Libre Chapinero', 'Bogotá', 'Calle 62 No. 9A-65', CENTRO_BOGOTA);
    assert.equal(r, null, 'aceptó la misma calle lejos del cruce que dice el registro');
  });
});

test('un sitio que la dirección sí confirma se publica con su localidad', async () => {
  await conRespuesta([respuestaBuena], async () => {
    const r = await geocodificarNombreConfirmandoDireccion(
      'Teatro Libre Chapinero', 'Bogotá', 'Calle 62 No. 9A-65', CENTRO_BOGOTA);
    assert.ok(r, 'descartó un punto que la dirección confirmaba');
    assert.equal(r.la, 4.6483169);
    assert.equal(r.lo, -74.0627025);
    assert.match(r.localidad.toLowerCase(), /chapinero/);
  });
});

test('los puntos con coordenada propia salen idénticos y los de relleno no salen', async () => {
  const items = [
    { k: 'ra:1', n: 'Palacio de los Deportes', mu: 'Bogotá', d: 'Calle 63 #47-06', la: 4.6552, lo: -74.0776, ap: 0 },
    { k: 'ra:2', n: 'MAFAPO', mu: 'Bogotá', d: 'Calle 54 #24-46', la: 4.646343, lo: -74.070997, ap: 0 },
    { k: 'ra:3', n: 'ZONA T', mu: 'Bogotá', d: 'Calle 82 #12-30', la: 4.6669283, lo: -74.0531611, ap: 0 },
    { k: 'ra:4', n: 'Sugoi Taller', mu: 'Bogotá', d: 'Carrera 24 #45-12', la: 4.63158, lo: -74.07295, ap: 0 },
    ...LOS_CUATRO.map((c, i) => ({ k: 'ra:relleno' + i, n: c.n, mu: 'Bogotá', d: c.d, ...RELLENO, ap: 0 })),
  ];
  const buenos = JSON.parse(JSON.stringify(items.slice(0, 4)));

  const res = await conCoordenadaConfiable({ DB: dbSinCache }, items, 0);

  assert.deepEqual(res, buenos, 'el camino feliz cambió');
  for (const a of res) assert.equal(coordenadaDeRelleno(a.la, a.lo), false);
});

test('sin poder geocodificar, el punto sigue sin publicarse', async () => {
  const items = LOS_CUATRO.map((c, i) => ({ k: 'ra:x' + i, n: c.n, mu: 'Bogotá', d: c.d, ...RELLENO, ap: 0 }));
  const rota = { prepare: () => { throw new Error('D1 caido'); } };
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('nominatim caido'); };
  try {
    const res = await conCoordenadaConfiable({ DB: rota }, items, 8);
    assert.deepEqual(res, [], 'publicó un punto sin haber podido ubicarlo');
  } finally { globalThis.fetch = real; }
});

test('las cuatro direcciones reales, contra el servicio', async (t) => {
  const obtenidas = [];
  for (const c of LOS_CUATRO) {
    let r = null;
    try {
      r = await geocodificarNombreConfirmandoDireccion(c.n, 'Bogotá', c.d, CENTRO_BOGOTA);
    } catch (e) {
      t.diagnostic(c.n + ': el servicio no respondió (' + e.message + ')');
      continue;
    }
    obtenidas.push([c.n, r]);
    t.diagnostic(c.n + ' | ' + c.d + ' | '
      + (r ? r.la + ',' + r.lo + ' | ' + r.localidad : 'sin coordenada, no se publica'));
    if (r) {
      assert.equal(coordenadaDeRelleno(r.la, r.lo), false, c.n + ' salió con otra coordenada de relleno');
      assert.ok(r.la > 4.4 && r.la < 4.9 && r.lo > -74.3 && r.lo < -73.9, c.n + ' cayó fuera de Bogotá');
    }
    await new Promise((s) => setTimeout(s, 1200));
  }

  const teatro = obtenidas.find((par) => par[0] === 'Teatro Libre Chapinero');
  if (teatro && teatro[1]) {
    assert.ok(Math.abs(teatro[1].la - 4.6483169) < 0.003, 'el Teatro Libre se movió de Chapinero');
    assert.ok(Math.abs(teatro[1].lo + 74.0627025) < 0.003, 'el Teatro Libre se movió de Chapinero');
    assert.match(teatro[1].localidad.toLowerCase(), /chapinero/);
  }

  const ubicadas = obtenidas.filter((par) => par[1]);
  for (let i = 0; i < ubicadas.length; i++) {
    for (let j = i + 1; j < ubicadas.length; j++) {
      const a = ubicadas[i][1], b = ubicadas[j][1];
      const d = Math.hypot((a.la - b.la) * 111.32,
        (a.lo - b.lo) * 111.32 * Math.cos(a.la * Math.PI / 180));
      assert.ok(d > 0.3,
        ubicadas[i][0] + ' y ' + ubicadas[j][0] + ' quedaron apilados a ' + d.toFixed(2) + ' km');
    }
  }
});
