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
    wheelchair_boarding INT, level_id TEXT, level_id_id INT, CONSTRAINT level_id_id FOREIGN KEY(level_id_id) REFERENCES levels(id),
    platform_code TEXT, is_active BOOLEAN, transit_score INT, parking_latlng GEOMETRY);
CREATE TABLE IF NOT EXISTS routes (id SERIAL PRIMARY KEY, route_id TEXT, agency_id TEXT, agency_id_id INT,
    CONSTRAINT agency_id_id FOREIGN KEY(agency_id_id) REFERENCES agency(id), route_short_name TEXT, route_long_name TEXT, route_desc TEXT, route_type INT,
    route_url TEXT, route_color TEXT, route_text_color TEXT, route_sort_order INT, continuous_pickup INT, continuous_drop_off INT, network_id TEXT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS shapes (id SERIAL PRIMARY KEY, geom GEOMETRY, route_type TEXT, is_active BOOLEAN);
CREATE TABLE IF NOT EXISTS trips (id SERIAL PRIMARY KEY, route_id TEXT, route_id_id INT, CONSTRAINT route_id_id FOREIGN KEY(route_id_id) REFERENCES routes(id), trip_id TEXT,
    trip_headsign TEXT, trip_short_name TEXT, direction_id INT, block_id TEXT, wheelchair_accessible INT, bikes_allowed INT, gtfs_trip_id INT,
    shape_id INT, CONSTRAINT shape_id FOREIGN KEY(shape_id) REFERENCES shapes(id), stops INT[], stops_info JSON[], api TEXT, is_today BOOLEAN, is_active BOOLEAN);

CREATE TABLE IF NOT EXISTS fare_tickets (id SERIAL PRIMARY KEY, code TEXT, zones INT, duration INT, 
    base_price INT, discounted_a_price INT, discounted_b_price INT, is_universal BOOLEAN DEFAULT FALSE);
INSERT INTO fare_tickets (code, zones, duration, base_price, discounted_a_price, discounted_b_price, is_universal) VALUES
('short2', 2, 15, 20, 10, 20, FALSE),
('long2', 2, 60, 25, 12, 25, FALSE),
('3', 3, 90, 33, 16, 31, FALSE),
('4', 4, 90, 41, 20, 35, FALSE),
('5', 5, 120, 49, 24, 39, FALSE),
('6', 6, 120, 57, 28, 43, FALSE),
('7', 7, 150, 65, 32, 47, FALSE),
('8', 8, 150, 73, 36, 51, FALSE),
('9', 9, 180, 81, 40, 55, FALSE),
('10', 10, 180, 89, 44, 59, FALSE),
('11', 11, 210, 97, 48, 63, FALSE),
('12', 12, 210, 105, 52, 67, FALSE),
('all', 2048, 240, 113, 56, 71, FALSE),
('universal', NULL, NULL, 180, 90, 90, TRUE);

CREATE TABLE IF NOT EXISTS planner_config (
    id SERIAL PRIMARY KEY, 
	config_name TEXT UNIQUE DEFAULT 'ids_jmk',
    fuel_price_default NUMERIC(10, 2) DEFAULT 44.50, 
    avg_fuel_consumption_default NUMERIC(6, 1) DEFAULT 6.5,
    car_maintenance_factor NUMERIC(5, 2) DEFAULT 2,
    emission_factor_CAR INT DEFAULT 192,
    emission_factor_BUS INT DEFAULT 68,
    emission_factor_FERRY INT DEFAULT 10,
    emission_factor_RAIL INT DEFAULT 14,
    emission_factor_TRAM INT DEFAULT 10,
    emission_factor_TROLLEYBUS INT DEFAULT 10,
    clustering_factor NUMERIC(4, 3) DEFAULT 0.43,
    transfer_hub_score INT DEFAULT 60,
    park_and_ride_decision_score INT DEFAULT 75,
    park_and_ride_decision_distance INT DEFAULT 5000, 
    transfer_hub_min_improvement INT DEFAULT 10,
    bounds_lat_min NUMERIC(6, 3) DEFAULT 48.63,
    bounds_lat_max NUMERIC(6, 3) DEFAULT 49.62,
    bounds_lng_min NUMERIC(6, 3) DEFAULT 15.62,
    bounds_lng_max NUMERIC(6, 3) DEFAULT 17.50
);
INSERT INTO planner_config DEFAULT VALUES;

CREATE INDEX IF NOT EXISTS idx_trips_route_gtfs
    ON trips(route_id_id, gtfs_trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_shape_id
    ON trips(shape_id);