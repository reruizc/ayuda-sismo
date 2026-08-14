-- Mapa de necesidades · sismo 10-ago-2026
-- Aplicar:  npx wrangler d1 execute ayuda-sismo --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS reportes (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,          -- epoch ms de creación
  actualizado   INTEGER NOT NULL,

  -- `sit` es la situación concreta que eligió la persona ('busco-mascota',
  -- 'ofr-alojamiento'…). Sustituye a la matriz tipo × categoría, que producía
  -- combinaciones sin sentido como "ofrezco + mascota". `tipo` y `cat` se
  -- DERIVAN del catálogo en el Worker y se guardan solo para poder filtrar y
  -- colorear el mapa sin recorrer el catálogo en cada consulta.
  sit           TEXT NOT NULL,
  tipo          TEXT NOT NULL,             -- busco | necesito | ofrezco
  cat           TEXT NOT NULL,             -- persona | mascota | rescate | viveres | ...

  urgencia      TEXT NOT NULL,             -- alta | media | baja
  titulo        TEXT NOT NULL,
  detalle       TEXT,
  depto         TEXT,
  municipio     TEXT,
  barrio        TEXT,
  personas      INTEGER,
  foto          TEXT,                      -- llave del objeto en R2, o NULL

  -- Ubicación. lat/lon es la EXACTA y nunca sale en el snapshot público:
  -- solo la ven moderación y las organizaciones verificadas.
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  -- plat/plon es la difuminada ~100 m que consume el mapa público. Se calcula
  -- UNA vez al insertar: si se recalculara por lectura, el punto bailaría entre
  -- snapshots y dos capturas permitirían triangular la posición real.
  plat          REAL NOT NULL,
  plon          REAL NOT NULL,

  -- Contacto. En las situaciones marcadas `priv` en el catálogo (buscar o
  -- haber encontrado a una PERSONA) NUNCA se publica: quien tenga información
  -- escribe por /contacto y el mensaje le llega al reportante.
  contacto      TEXT,
  contacto_tipo TEXT,                      -- tel | email
  contacto_pub  INTEGER NOT NULL DEFAULT 0,

  estado        TEXT NOT NULL DEFAULT 'activo',   -- activo | resuelto | oculto
  token         TEXT NOT NULL,             -- el reportante edita/cierra con esto
  ip_hash       TEXT,
  sin_captcha   INTEGER NOT NULL DEFAULT 0,
  abusos        INTEGER NOT NULL DEFAULT 0,
  verificado    INTEGER NOT NULL DEFAULT 0 -- lo marca una organización
);

CREATE INDEX IF NOT EXISTS idx_reportes_snapshot ON reportes (estado, ts DESC);
CREATE INDEX IF NOT EXISTS idx_reportes_ip       ON reportes (ip_hash, ts);

-- Mensajes del contacto intermediado.
CREATE TABLE IF NOT EXISTS mensajes (
  id         TEXT PRIMARY KEY,
  reporte_id TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  mensaje    TEXT NOT NULL,
  de         TEXT,                         -- cómo devolverle el contacto
  ip_hash    TEXT,
  leido      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (reporte_id) REFERENCES reportes(id)
);

CREATE INDEX IF NOT EXISTS idx_mensajes_reporte ON mensajes (reporte_id, ts DESC);

-- Pulso de prensa. Una sola fila ('actual') con el agregado más reciente: la
-- página lo lee entero y el cron lo reescribe. No se guarda histórico de
-- titulares a propósito — lo que se publica son conteos, no un archivo de
-- prensa ajena.
CREATE TABLE IF NOT EXISTS inteligencia (
  id    TEXT PRIMARY KEY,
  ts    INTEGER NOT NULL,
  datos TEXT NOT NULL
);

-- Marcas de abuso. La llave única (reporte, ip) es el control de verdad: sin
-- ella una sola persona podría inflar el contador de un reporte legítimo hasta
-- mandarlo a la cola de moderación.
CREATE TABLE IF NOT EXISTS abuso_log (
  reporte_id TEXT NOT NULL,
  ip_hash    TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  PRIMARY KEY (reporte_id, ip_hash)
);

-- Copias de fuentes externas que se editan por fuera (hoja de acopios).
-- Se guarda la última copia BUENA: si una edición deja la hoja vacía o rota,
-- el mapa sigue mostrando lo último válido en vez de quedarse sin acopios.
CREATE TABLE IF NOT EXISTS externos (
  id    TEXT PRIMARY KEY,
  ts    INTEGER NOT NULL,
  datos TEXT NOT NULL
);

-- Coordenadas resueltas por NOMBRE del sitio contra OpenStreetMap.
-- Se cachean para siempre: la ubicación de un hospital no cambia, y volver a
-- preguntar por cada refresco abusaría de un servicio gratuito.
CREATE TABLE IF NOT EXISTS geocache (
  clave  TEXT PRIMARY KEY,     -- nombre|municipio normalizados
  lat    REAL,                 -- NULL = se buscó y no se encontró
  lon    REAL,
  fuente TEXT,
  ts     INTEGER NOT NULL
);
