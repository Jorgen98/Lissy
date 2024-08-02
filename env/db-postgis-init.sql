CREATE EXTENSION IF NOT EXISTS postgis CASCADE;
CREATE TABLE IF NOT EXISTS rail (gid SERIAL PRIMARY KEY, geom GEOMETRY, conns INT[]);
CREATE TABLE IF NOT EXISTS road (gid SERIAL PRIMARY KEY, geom GEOMETRY, conns INT[]);
CREATE TABLE IF NOT EXISTS tram (gid SERIAL PRIMARY KEY, geom GEOMETRY, conns INT[]);
CREATE TABLE IF NOT EXISTS midpoints (gid SERIAL PRIMARY KEY, geom_stop_a GEOMETRY, geom_stop_b GEOMETRY, midpoints GEOMETRY);
CREATE TABLE IF NOT EXISTS net_stats (id SERIAL PRIMARY KEY, rail_valid BIGINT, road_valid BIGINT, tram_valid BIGINT, midpoints_valid BIGINT);
INSERT INTO net_stats (rail_valid, road_valid, tram_valid, midpoints_valid) VALUES (0, 0, 0, 0);

CREATE TABLE IF NOT EXISTS agency (id SERIAL PRIMARY KEY, agency_id TEXT, agency_name TEXT, agency_url TEXT, agency_timezone TEXT,
    agency_lang TEXT, agency_phone TEXT, agency_fare_url TEXT, agency_email TEXT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS levels (id SERIAL PRIMARY KEY, level_id TEXT, level_index INT, level_name TEXT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, stop_id TEXT, stop_code TEXT, stop_name TEXT, tts_stop_name TEXT, stop_desc TEXT,
    latLng GEOMETRY, zone_id TEXT, stop_url TEXT, location_type INT, parent_station TEXT,
    parent_station_id INT, CONSTRAINT parent_station_id FOREIGN KEY(parent_station_id) REFERENCES stops(id), stop_timezone TEXT,
    wheelchair_boarding INT, level_id TEXT, level_id_id INT, CONSTRAINT level_id_id FOREIGN KEY(level_id_id) REFERENCES levels(id), platform_code TEXT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS routes (id SERIAL PRIMARY KEY, route_id TEXT, agency_id TEXT, agency_id_id INT,
    CONSTRAINT agency_id_id FOREIGN KEY(agency_id_id) REFERENCES agency(id), route_short_name TEXT, route_long_name TEXT, route_desc TEXT, route_type INT,
    route_url TEXT, route_color TEXT, route_text_color TEXT, route_sort_order INT, continuous_pickup INT, continuous_drop_off INT, network_id TEXT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS shapes (id SERIAL PRIMARY KEY, geom GEOMETRY, route_type TEXT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS trips (id SERIAL PRIMARY KEY, route_id TEXT, route_id_id INT, CONSTRAINT route_id_id FOREIGN KEY(route_id_id) REFERENCES routes(id), trip_id TEXT,
    trip_headsign TEXT, trip_short_name TEXT, direction_id INT, block_id TEXT, wheelchair_accessible INT, bikes_allowed INT,
    shape_id INT, CONSTRAINT shape_id FOREIGN KEY(shape_id) REFERENCES shapes(id), stops INT[], stops_info JSON[], api TEXT, is_active BOOLEAN);
