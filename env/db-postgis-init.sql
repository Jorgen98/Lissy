CREATE EXTENSION IF NOT EXISTS postgis CASCADE;
CREATE TABLE IF NOT EXISTS rail (gid SERIAL PRIMARY KEY, geom GEOMETRY, conns INT[]);
CREATE TABLE IF NOT EXISTS road (gid SERIAL PRIMARY KEY, geom GEOMETRY, conns INT[]);
CREATE TABLE IF NOT EXISTS tram (gid SERIAL PRIMARY KEY, geom GEOMETRY, conns INT[]);
CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, stop_id TEXT, stop_name TEXT, latLng GEOMETRY, zone_id TEXT, parent_station TEXT,
    parent_station_id INT, CONSTRAINT parent_station_id FOREIGN KEY(parent_station_id) REFERENCES stops(id), wheelchair_boarding INT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS lines (id SERIAL PRIMARY KEY, route_id TEXT, agency_id TEXT, route_short_name TEXT, route_long_name TEXT,
    route_type INT, route_color TEXT, route_text_color TEXT, day_time INT, is_active BOOLEAN);