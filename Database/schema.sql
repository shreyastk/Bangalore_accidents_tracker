-- Bangalore Accidents Tracker — PostgreSQL + PostGIS
-- Run once: psql $DATABASE_URL -f Database/schema.sql

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS accidents (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  source        TEXT,
  link          TEXT,
  location      TEXT,
  area          TEXT,
  zone          TEXT,
  severity      TEXT NOT NULL CHECK (severity IN ('fatal', 'serious', 'minor')),
  score         INTEGER,
  date_raw      TEXT,
  accident_date DATE,
  has_coords    BOOLEAN NOT NULL DEFAULT FALSE,
  geom          geometry(Point, 4326)
);

CREATE INDEX IF NOT EXISTS accidents_geom_gix ON accidents USING GIST (geom);
CREATE INDEX IF NOT EXISTS accidents_severity_ix ON accidents (severity);
CREATE INDEX IF NOT EXISTS accidents_area_ix ON accidents (area);
CREATE INDEX IF NOT EXISTS accidents_zone_ix ON accidents (zone);
CREATE INDEX IF NOT EXISTS accidents_date_ix ON accidents (accident_date);

COMMENT ON TABLE accidents IS 'News and verified incidents; geom is WGS84 (SRID 4326).';
