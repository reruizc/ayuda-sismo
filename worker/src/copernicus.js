/**
 * Daño evaluado desde satélite · Copernicus EMS Rapid Mapping (EMSR916).
 *
 * Es la contraparte de lo que ya publica el mapa. Los reportes son NECESIDAD
 * DECLARADA por la gente; esto es DAÑO OBSERVADO desde satélite por el servicio
 * de emergencias de la Unión Europea: edificios destruidos o dañados, tramos de
 * vía afectados y bloqueos de vía, cada uno con su coordenada.
 *
 * ⚠️⚠️ ESTO NO CUBRE EL PAÍS, Y ESA ES LA ADVERTENCIA PRINCIPAL. Copernicus
 * analizó unas pocas manchas urbanas (Buenaventura, Pereira, Quibdó, dos zonas
 * de Cali, Istmina). San José del Palmar —el epicentro— no tiene zona
 * analizada. La ausencia de puntos NO significa ausencia de daño: significa que
 * nadie miró ahí todavía. La página tiene que decirlo donde se ve la capa, no
 * en una nota al pie.
 *
 * ⚠️ "Posiblemente dañado" es fotointerpretación, no daño confirmado. Se guarda
 * en su propio grado y nunca se suma con "destruido" en una sola cifra.
 *
 * ⚠️ Una zona puede tener varias entregas (producto inicial + monitoreos). Son
 * la MISMA zona re-evaluada, no zonas distintas: sumarlas contaría los mismos
 * edificios dos veces. Se conserva solo la entrega más reciente por zona.
 *
 * Fuente: API pública, sin clave.
 *   https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=EMSR916
 * Los vectores salen del bucket del visor cambiando el sufijo `_VT` por `.json`.
 * Licencia: reutilización libre citando
 *   © Unión Europea, Copernicus Emergency Management Service (EMSR916)
 */

const ACTIVACION = 'EMSR916';
const API = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/';
const UA = { 'User-Agent': 'MapaDeAyuda/1.0 (+https://reconstruyocolombia.com)' };

/** Los nombres del producto vienen en inglés y la página está en español. */
const NOMBRE_ES = {
  'Western Colombia': 'Occidente de Colombia',
  'Northern Cali': 'Cali · norte',
  'Cali Center': 'Cali · centro',
  'Quibdo Centre': 'Quibdó · centro',
  Pereira: 'Pereira',
  Istmina: 'Istmina',
  Buenaventura: 'Buenaventura',
};

/**
 * Grados de daño que se publican, del peor al más incierto.
 *
 * Lo que NO está acá se descarta a propósito: "No visible damage" son las
 * decenas de miles de vías intactas que hacen pesado el archivo sin decir nada,
 * y "Not Analysed" es justamente lo que no se miró.
 */
const GRADO = {
  Destroyed: 3,
  Damaged: 2,
  'Possibly damaged': 1,
};

/** Tipo de construcción, para no publicar el código crudo del producto. */
function tipoEs(objType) {
  const t = String(objType || '').toLowerCase();
  if (t.includes('residential') && !t.includes('non-residential')) return 'vivienda';
  if (t.includes('school') || t.includes('university') || t.includes('research')) return 'educativo';
  if (t.includes('medical') || t.includes('health') || t.includes('hospital')) return 'salud';
  if (t.includes('non-residential')) return 'no residencial';
  return 'edificación';
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** "POLYGON ((lon lat, lon lat, …))" → [[lat, lon], …] para Leaflet. */
function anillo(wkt) {
  const m = String(wkt || '').match(/\(\(([^)]+)\)\)/);
  if (!m) return null;
  const pts = m[1].split(',').map((par) => {
    const [lo, la] = par.trim().split(/\s+/).map(Number);
    return Number.isFinite(la) && Number.isFinite(lo) ? [r6(la), r6(lo)] : null;
  });
  return pts.every(Boolean) && pts.length > 2 ? pts : null;
}

async function traerJSON(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

/** La capa vectorial del visor tiene su gemela GeoJSON en la misma ruta. */
const urlCapa = (bucket, nombre) => `${bucket.replace(/\/+$/, '')}/${nombre.replace(/_VT$/, '')}.json`;

/**
 * Se queda con UNA entrega por zona: la última entregada.
 *
 * Sin esto Buenaventura aparecería dos veces (producto inicial con 256
 * edificios y monitoreo con 335) y el total diría 591 donde hay 335.
 */
function ultimaEntregaPorZona(aois) {
  const salida = [];
  for (const aoi of aois || []) {
    const entregados = (aoi.products || []).filter(
      (p) => p?.version?.statusCode === 'F' && (p.layers || []).length
    );
    if (!entregados.length) continue;
    entregados.sort((a, b) => {
      const ta = Date.parse(a.version?.deliveryTime || 0) || 0;
      const tb = Date.parse(b.version?.deliveryTime || 0) || 0;
      return tb - ta || (b.monitoringNumber || 0) - (a.monitoringNumber || 0);
    });
    salida.push({ aoi, producto: entregados[0], descartados: entregados.length - 1 });
  }
  return salida;
}

/** Población estimada de la zona, tal como la reporta el producto. */
function poblacion(stats) {
  const v = stats?.['Estimated population']?.None?.total;
  return typeof v === 'number' ? v : null;
}

export async function refrescar(env) {
  const raiz = await traerJSON(`${API}?code=${ACTIVACION}`);
  const act = raiz?.results?.[0];
  if (!act) throw new Error('la activación no vino en la respuesta');

  const bucket = act.aws_bucket;
  if (!bucket) throw new Error('sin bucket de vectores');

  const zonas = [];
  const danos = [];      // [lat, lon, grado, zona, tipo]
  const bloqueos = [];   // [lat, lon, zona]
  const vias = [];       // [[[lat,lon]…], zona]
  let pendientes = 0;
  const fallos = [];

  for (const { aoi, producto } of ultimaEntregaPorZona(act.aois)) {
    const iz = zonas.length;
    const cuenta = { 3: 0, 2: 0, 1: 0 };
    let bloq = 0, tramos = 0;

    for (const capa of producto.layers || []) {
      if (capa.format !== 'vt') continue;              // los COG son imagen, no vector
      const nombre = capa.name || '';
      const esEdificio = /_builtUpP_/.test(nombre);
      const esVia = /_transportationL_/.test(nombre);
      const esBloqueo = /_ancillaryCrisisInfoP_/.test(nombre);
      if (!esEdificio && !esVia && !esBloqueo) continue;

      let fc;
      try {
        fc = await traerJSON(urlCapa(bucket, nombre));
      } catch (e) {
        fallos.push(`${aoi.name}: ${nombre.split('/').pop()} (${e.message})`);
        continue;
      }

      for (const f of fc.features || []) {
        const p = f.properties || {};
        const g = f.geometry || {};

        if (esEdificio && g.type === 'Point') {
          const grado = GRADO[p.damage_gra];
          if (!grado) continue;
          danos.push([r6(g.coordinates[1]), r6(g.coordinates[0]), grado, iz, tipoEs(p.obj_type)]);
          cuenta[grado]++;
        } else if (esBloqueo && g.type === 'Point') {
          // Un bloqueo de vía es lo más accionable de todo el paquete: le dice
          // a quien va a llevar ayuda por dónde NO puede pasar.
          bloqueos.push([r6(g.coordinates[1]), r6(g.coordinates[0]), iz]);
          bloq++;
        } else if (esVia && GRADO[p.damage_gra]) {
          // Solo los tramos con daño. Las vías intactas son >11.000 rasgos que
          // multiplicarían el peso del archivo sin aportar una sola decisión.
          const lineas = g.type === 'MultiLineString' ? g.coordinates
                       : g.type === 'LineString' ? [g.coordinates] : [];
          for (const l of lineas) {
            vias.push([l.map(([lo, la]) => [r6(la), r6(lo)]), iz]);
            tramos++;
          }
        }
      }
    }

    zonas.push({
      n: NOMBRE_ES[aoi.name] || aoi.name,
      num: aoi.number,
      entregado: producto.version?.deliveryTime || null,
      monitoreo: producto.monitoringNumber || 0,
      pob: poblacion(producto.stats),
      poly: anillo(aoi.extent),
      destruidos: cuenta[3], danados: cuenta[2], posibles: cuenta[1],
      bloqueos: bloq, vias: tramos,
    });
  }

  // Zonas pedidas que todavía no tienen entrega: se anuncian como "en curso"
  // en vez de desaparecer, porque su silencio no es ausencia de daño.
  for (const aoi of act.aois || []) {
    const tiene = (aoi.products || []).some((p) => p?.version?.statusCode === 'F');
    if (!tiene) pendientes++;
  }

  if (!danos.length) throw new Error('ninguna capa trajo edificios evaluados');

  const datos = {
    generado: Date.now(),
    activacion: ACTIVACION,
    nombre: act.name || '',
    evento: act.eventTime || null,
    fuente: 'https://mapping.emergency.copernicus.eu/activations/EMSR916/',
    informe: act.reportLink || null,
    credito: '© Unión Europea, Copernicus Emergency Management Service (EMSR916)',
    ultima_entrega: zonas.reduce(
      (a, z) => (z.entregado && (!a || z.entregado > a) ? z.entregado : a), null),
    zonas_pendientes: pendientes,
    total: {
      destruidos: danos.filter((d) => d[2] === 3).length,
      danados: danos.filter((d) => d[2] === 2).length,
      posibles: danos.filter((d) => d[2] === 1).length,
      bloqueos: bloqueos.length,
      vias: vias.length,
      zonas: zonas.length,
    },
    zonas, danos, bloqueos, vias,
    fallos: fallos.length ? fallos : undefined,
  };

  await env.DB.prepare(
    `INSERT INTO externos (id, ts, datos) VALUES ('copernicus', ?, ?)
     ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, datos = excluded.datos`
  ).bind(datos.generado, JSON.stringify(datos)).run();

  return datos;
}

/**
 * Devuelve el daño evaluado. NO refresca por visita: lo hace el cron una vez al
 * día, que es el ritmo al que Copernicus entrega productos nuevos.
 *
 * ⚠️ Si la recolección falló, se sirve la última copia buena. Un fallo de red
 * del lado de Copernicus no puede dejar el mapa sin la capa de daño.
 */
export async function leer(env) {
  try {
    const row = await env.DB.prepare("SELECT datos FROM externos WHERE id = 'copernicus'").first();
    if (row?.datos) return JSON.parse(row.datos);
  } catch { /* aún no hay copia */ }
  return null;
}
