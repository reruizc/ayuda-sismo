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

-- Correcciones que manda la gente sobre un centro de acopio.
--
-- ⚠️⚠️ ESTO NO EDITA EL MAPA. Una edición abierta sobre un acopio no es un
-- problema de spam sino de daño: cerrar uno que está operando, o cambiarle la
-- dirección, manda gente con mercados a una puerta equivocada. Acá se ACUMULA
-- lo que la gente reporta; el mapa solo cambia cuando alguien aprueba desde el
-- panel, y entonces el cambio aprobado queda en `acopio_overlay`.
CREATE TABLE IF NOT EXISTS sugerencias (
  id        TEXT PRIMARY KEY,
  ts        INTEGER NOT NULL,

  -- Identidad del acopio: nombre|municipio normalizados (`claveDe` en
  -- acopios.js). La hoja no trae id, así que es lo único estable que hay.
  clave     TEXT NOT NULL,
  -- Nombre y ubicación tal como estaban al sugerir. Se copian para que el
  -- panel siga siendo legible aunque la fila cambie o salga de la hoja.
  acopio    TEXT NOT NULL,
  municipio TEXT,
  depto     TEXT,

  tipo      TEXT NOT NULL,             -- correccion | cierre | confirmacion
  -- JSON { campo: { de, a } } con SOLO lo que cambia. Guardar el "de" es lo
  -- que deja ver en el panel qué se está reemplazando, sin abrir la hoja.
  campos    TEXT NOT NULL,
  nota      TEXT,
  contacto  TEXT,                      -- de quien corrige, opcional

  estado    TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | aplicada | rechazada
  ip_hash   TEXT,
  sin_captcha INTEGER NOT NULL DEFAULT 0,
  revisado  INTEGER                    -- epoch ms en que se aprobó o rechazó
);

CREATE INDEX IF NOT EXISTS idx_sugerencias       ON sugerencias (estado, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sugerencias_clave ON sugerencias (clave, ts DESC);
CREATE INDEX IF NOT EXISTS idx_sugerencias_ip    ON sugerencias (ip_hash, ts);

-- Lo YA APROBADO, pintado encima de la fila de la hoja al servir el mapa.
--
-- Existe porque el Worker no puede escribir en Google Sheets: sin esto,
-- aprobar no cambiaría nada hasta que alguien lo transcribiera a mano, que es
-- justo la demora que hace que un acopio cerrado siga recibiendo gente.
-- Se limpia solo cuando la hoja alcanza el valor aprobado (ver
-- `aplicarOverlays`), así que es un puente hacia la hoja y no una segunda
-- fuente de verdad que compita con ella.
CREATE TABLE IF NOT EXISTS acopio_overlay (
  clave  TEXT PRIMARY KEY,
  ts     INTEGER NOT NULL,
  campos TEXT NOT NULL,      -- JSON { d, ne, ab, ci, di, tel, c, rev, tipo, vol, cerrado }
  origen TEXT                -- id de la sugerencia que lo produjo
);

-- Bitácora de las corridas del cron.
--
-- ⚠️⚠️ Existe porque una corrida en cero era INDISTINGUIBLE de una buena: el
-- agregado vacío se escribía encima del bueno y la página quedaba muda. Acá
-- queda constancia de cada corrida —salga bien o mal—, si se publicó o se
-- descartó, y el detalle por consulta cuando algo falló.
CREATE TABLE IF NOT EXISTS corridas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  tarea     TEXT NOT NULL,             -- prensa | acopios
  origen    TEXT NOT NULL,             -- cron | manual
  ok        INTEGER NOT NULL,          -- la recolección sirvió
  publicado INTEGER NOT NULL,          -- se escribió, o se conservó lo anterior
  ms        INTEGER,
  notas     INTEGER,
  medios    INTEGER,
  detalle   TEXT                       -- JSON con el resultado de cada consulta
);

CREATE INDEX IF NOT EXISTS idx_corridas ON corridas (tarea, ts DESC);

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
