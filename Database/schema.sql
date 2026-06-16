-- Bangalore Accidents Tracker — PostgreSQL + PostGIS
-- Run once: psql $DATABASE_URL -f Database/schema.sql

-- Enable PostGIS extension for spatial data
CREATE EXTENSION IF NOT EXISTS postgis;

-- Ensure SRID 4326 (WGS 84) exists in spatial_ref_sys
-- This is the standard GPS coordinate system used for lat/lng
INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext)
VALUES (
  4326,
  'EPSG',
  4326,
  '+proj=longlat +datum=WGS84 +no_defs',
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
)
ON CONFLICT (srid) DO NOTHING;

-- ─── Main accidents table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accidents (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  source        TEXT,
  link          TEXT,
  location      TEXT,
  area          TEXT,
  zone          TEXT,
  severity      TEXT NOT NULL CHECK (severity IN ('fatal', 'serious', 'minor')),
  score         INTEGER CHECK (score >= 1 AND score <= 10),
  date_raw      TEXT,
  accident_date DATE,
  has_coords    BOOLEAN NOT NULL DEFAULT FALSE,
  geom          geometry(Point, 4326),
  status        TEXT NOT NULL DEFAULT 'active',
  reporter_id   TEXT,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── Indexes for performance ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS accidents_geom_gix    ON accidents USING GIST (geom);
CREATE INDEX IF NOT EXISTS accidents_severity_ix ON accidents (severity);
CREATE INDEX IF NOT EXISTS accidents_area_ix     ON accidents (area);
CREATE INDEX IF NOT EXISTS accidents_zone_ix     ON accidents (zone);
CREATE INDEX IF NOT EXISTS accidents_date_ix     ON accidents (accident_date);
CREATE INDEX IF NOT EXISTS accidents_status_ix   ON accidents (status);
CREATE INDEX IF NOT EXISTS accidents_score_ix    ON accidents (score);

COMMENT ON TABLE accidents IS 'News and verified road accident incidents in Bangalore; geom is WGS84 (SRID 4326).';
COMMENT ON COLUMN accidents.geom IS 'PostGIS Point geometry in SRID 4326 (WGS 84 - standard GPS coordinates)';
COMMENT ON COLUMN accidents.score IS 'Severity score 1-10: 1=no injury, 6=1 death, 8=3 deaths, 10=5+ deaths';
COMMENT ON COLUMN accidents.zone IS 'Traffic zone: North, South, East, West, Central, Highway / ORR, Other';
COMMENT ON COLUMN accidents.status IS 'Record status: active (shown on map), pending (awaiting review), hidden (rejected)';

-- ─── Register geometry column in PostGIS metadata ───────────────────────────

-- This ensures the geometry_columns view correctly references our table
SELECT Populate_Geometry_Columns('public.accidents'::regclass);

-- ─── RPC Function: get_accidents_fc ─────────────────────────────────────────
-- Returns a GeoJSON FeatureCollection for the dashboard map

CREATE OR REPLACE FUNCTION get_accidents_fc(
  p_from     TEXT DEFAULT NULL,
  p_to       TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT NULL,
  p_area     TEXT DEFAULT NULL,
  p_zone     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(feat), '[]'::jsonb)
  )
  FROM (
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(geom)::jsonb,
      'properties', jsonb_build_object(
        'id',       id,
        'title',    title,
        'source',   source,
        'link',     link,
        'location', location,
        'area',     area,
        'zone',     zone,
        'severity', severity,
        'score',    score,
        'date',     COALESCE(accident_date::TEXT, date_raw, '—'),
        'isUser',   (reporter_id IS NOT NULL)
      )
    ) AS feat
    FROM accidents
    WHERE status = 'active'
      AND has_coords = TRUE
      AND geom IS NOT NULL
      AND (p_from     IS NULL OR accident_date >= p_from::DATE)
      AND (p_to       IS NULL OR accident_date <= p_to::DATE)
      AND (p_severity IS NULL OR severity = p_severity)
      AND (p_area     IS NULL OR area ILIKE '%' || p_area || '%')
      AND (p_zone     IS NULL OR zone = p_zone)
    ORDER BY accident_date DESC NULLS LAST
  ) sub;
$$;

COMMENT ON FUNCTION get_accidents_fc IS 'Returns GeoJSON FeatureCollection of active accidents with spatial filtering';

-- ─── Spatial validation constraint ──────────────────────────────────────────
-- Ensure all geometries are within Bangalore metropolitan region bounding box

ALTER TABLE accidents DROP CONSTRAINT IF EXISTS accidents_geom_bbox;
ALTER TABLE accidents ADD CONSTRAINT accidents_geom_bbox
  CHECK (
    geom IS NULL OR
    ST_Within(geom, ST_MakeEnvelope(77.0, 12.5, 78.2, 13.5, 4326))
  );

COMMENT ON CONSTRAINT accidents_geom_bbox ON accidents IS 'Ensures all points fall within the Bangalore metropolitan bounding box';
