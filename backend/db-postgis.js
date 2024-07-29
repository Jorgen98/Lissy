/*
 * DB PostGIS function file
 */

const Pool = require('pg').Pool;
const dotenv = require('dotenv');
const fs = require('fs');

const logService = require('./log.js');

// .env file include
dotenv.config();

let newNets = {
    rail: undefined,
    road: undefined,
    tram: undefined
}

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.DB_POSTGIS_MODULE_NAME, type, msg)
}

// PostGIS DB instant
const db_postgis = new Pool({
    user: process.env.DB_POSTGIS_USER,
    host: process.env.DB_POSTGIS_HOST,
    database: process.env.DB_POSTGIS_DATABASE,
    password: process.env.DB_POSTGIS_PASSWORD,
    port: process.env.DB_POSTGIS_PORT
});

// Function for DB connection create
async function connectToDB() {
    try {
        await db_postgis.connect();
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Function for road and rail nets actualization
// Try to search for net files in working directory
async function reloadNetFiles() {
    newNets = {};

    log('info', 'Searching for new net files');
    await scanDirectory('./');

    log('info', 'Processing loaded files');
    if (!await reloadNet('rail', newNets['rail'])) {
        return false;
    }

    if (!await reloadNet('road', newNets['road'])) {
        return false;
    }

    if (!await reloadNet('tram', newNets['tram'])) {
        return false;
    }

    log('info', 'Transit net inspection done');

    newNets = {};
    return true;
}

// Function for scanning single directory
async function scanDirectory(location) {
    for (const file of fs.readdirSync(location)) {
        let rawData;
        let inputData;

        if (fs.statSync(`${location}/${file}`).isFile()) {
            try {
                rawData = fs.readFileSync(`${location}/${file}`);
            } catch (error) {
                continue;
            }
    
            try {
                inputData = JSON.parse(rawData);
                if (inputData.type && inputData.valid && inputData.hubs) {
                    if (newNets[inputData.type] === undefined || new Date(inputData.valid) > new Date(newNets[inputData.type].valid)) {
                        newNets[inputData.type] = inputData;
                    }
                }
            } catch (err){
                continue;
            }
        } else {
            await scanDirectory(`${location}/${file}/`);
        }
    }
}

// Function for reloading net files intro DB if any exists
async function reloadNet(net, inputData) {
    let acState;
    try {
        acState = await db_postgis.query(`SELECT COUNT(gid) FROM ${net}`);
        acState = parseInt(acState.rows[0].count);
    } catch(error) {
        log('error', error);
        return false;
    }

    if (acState === 0 && inputData === undefined) {
        return false;
    }

    if (acState > 0) {
        if (inputData === undefined) {
            return true;
        }
        if (!await deleteNet(net)) {
            return false;
        };
    }

    let query = '';
    for (let [idx, point] of inputData.hubs.entries()) {
        if (point["p"] === undefined) {
            continue;
        }
    
        if (point["n"] === undefined) {
            continue;
        }

        for (let i = 0; i < point["n"].length; i++) {
            point["n"][i] += 1;
        }

        let pointQuery = `('{"type": "Point", "coordinates": ${JSON.stringify(point["p"])}}' `;
        query += `${pointQuery}, ARRAY ${JSON.stringify(point["n"])}::integer[])`;

        if (inputData.hubs.length > 0 && idx < (inputData.hubs.length - 1)) {
            query += ",";
        }
    }

    if (query === '') {
        return true;
    }

    try {
        await db_postgis.query(`INSERT INTO ${net} (geom, conns) VALUES ${query}`);
        log('success', `Transit ${net} successfully actualized`);
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Function for removing whole net
async function deleteNet(net) {
    try {
        await db_postgis.query(`TRUNCATE TABLE ${net} RESTART IDENTITY`);
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }

    // TO DO
    // Make shapes & trips inactive
}

// Function for return closes net points to provided stop position
async function getPointsAroundStation(stopLatLng, layer, maxPointNum) {
    let res;
    try {
        res = await db_postgis.query(`SELECT *, ST_AsGeoJSON(geom) FROM ${layer}
            WHERE ST_DistanceSphere(geom, '${stopLatLng}') <= ${maxPointNum}`);
    } catch(error) {
        log('error', error);
        return [];
    }

    for (let row of res.rows) {
        row['latLng'] = JSON.parse(row['st_asgeojson']).coordinates;
        delete row['st_asgeojson'];
        delete row['geom'];
    }

    return res.rows;
}

// Function for return only part of transit net around two points
async function getSubNet(stopALatLng, stopBLatLng, transportMode, netRadius) {
    let res;
    let centerPoint = [Math.abs(stopALatLng.latLng[0] + stopALatLng.latLng[0]) / 2, Math.abs(stopALatLng.latLng[1] + stopBLatLng.latLng[1]) / 2];

    try {
        res = await db_postgis.query(`SELECT gid, conns, ST_AsGeoJSON(geom) FROM ${transportMode}
            WHERE ST_DistanceSphere(geom, '{"type": "Point", "coordinates": ${JSON.stringify(centerPoint)}}')
            <= ST_DistanceSpheroid('${stopALatLng.geom}', '{"type": "Point", "coordinates": ${JSON.stringify(centerPoint)}}') * ${netRadius}`);
    } catch(error) {
        log('error', error);
        return {};
    }

    let output = {};
    for (let row of res.rows) {
        output[row.gid] = {'pos': JSON.parse(row['st_asgeojson']).coordinates, 'conns': row.conns};
    }

    return output;
}

// Add new agency to DB, returns new id
async function addAgency(agency) {
    try {
        let id = await db_postgis.query(`INSERT INTO agency (agency_id, agency_name, agency_url, agency_timezone,
            agency_lang, agency_phone, agency_fare_url, agency_email, is_active) VALUES ('${agency.agency_id}',
            '${agency.agency_name}', '${agency.agency_url}', '${agency.agency_timezone}', '${agency.agency_lang}',
            '${agency.agency_phone}', '${agency.agency_fare_url}', '${agency.agency_email}', true) RETURNING id`);
        return id.rows[0].id;
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Get all agencies used in actual transit system state
async function getActiveAgencies() {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, agency_id, agency_name, agency_url, agency_timezone,
            agency_lang, agency_phone, agency_fare_url, agency_email FROM agency WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let output = {};

    for (const row of result.rows) {
        output[row['agency_id']] = row;
    }

    return output;
}

// Add new stop to DB, returns new id
async function addStop(stop) {
    try {
        let id = await db_postgis.query(`INSERT INTO stops (stop_id, stop_code, stop_name, tts_stop_name, stop_desc, latLng, zone_id, stop_url, location_type,
            parent_station, parent_station_id, stop_timezone, wheelchair_boarding, level_id, level_id_id, platform_code, is_active)
            VALUES ('${stop.stop_id}', '${stop.stop_code}', '${stop.stop_name}', '${stop.tts_stop_name}', '${stop.stop_desc}',
            '{"type": "Point", "coordinates": ${JSON.stringify(stop.latLng)}}', '${stop.zone_id}', '${stop.stop_url}', ${stop.location_type}, '${stop.parent_station}',
            ${stop.parent_station_id}, '${stop.stop_timezone}', ${stop.wheelchair_boarding}, '${stop.level_id}', ${stop.level_id_id}, '${stop.platform_code}', true) RETURNING id`);
        return id.rows[0].id;
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Get all stops used in actual transit system state
async function getActiveStops() {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, stop_id, stop_code, stop_name, tts_stop_name, stop_desc,
            latLng, zone_id, stop_url, location_type, parent_station, parent_station_id, stop_timezone,
            wheelchair_boarding, level_id, level_id_id, platform_code, ST_AsGeoJSON(latLng) FROM stops WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let output = {};

    for (const row of result.rows) {
        row['latLng'] = JSON.parse(row['st_asgeojson']).coordinates;
        delete row['st_asgeojson'];
        delete row['latlng'];
        output[row['stop_id']] = row;
    }

    return output;
}

// Get list of stop latLngs by list of ids
async function getStopPositions(stopIds) {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, latlng, ST_AsGeoJSON(latLng) FROM stops WHERE is_active=true AND id IN (${stopIds})`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let output = [];
    let tmpOutput = {};

    for (const row of result.rows) {
        tmpOutput[row['id']] = {
            latLng: JSON.parse(row['st_asgeojson']).coordinates,
            geom: row['latlng']
        }
    }

    for (const stopId of stopIds) {
        if (tmpOutput[stopId] === undefined) {
            return [];
        } else {
            output.push(tmpOutput[stopId]);
        }
    }

    return output;
}

// Add new route to DB, returns new id
async function addRoute(route) {
    try {
        let id = await db_postgis.query(`INSERT INTO routes (route_id, agency_id, agency_id_id, route_short_name, route_long_name,
            route_desc, route_type, route_url, route_color, route_text_color, route_sort_order, continuous_pickup,
            continuous_drop_off, network_id, is_active) VALUES ('${route.route_id}', '${route.agency_id}', ${route.agency_id_id},
            '${route.route_short_name}', '${route.route_long_name}', '${route.route_desc}', ${route.route_type},
            '${route.route_url}', '${route.route_color}', '${route.route_text_color}', ${route.route_sort_order},
             ${route.continuous_pickup}, ${route.continuous_drop_off}, '${route.network_id}',  true) RETURNING id`);
        return id.rows[0].id;
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Get all lines used in actual transit system state
async function getActiveRoutes() {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, route_id, agency_id, agency_id_id, route_short_name, route_long_name,
            route_desc, route_type, route_url, route_color, route_text_color, route_sort_order, continuous_pickup,
            continuous_drop_off, network_id FROM routes WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let output = {};

    for (const row of result.rows) {
        output[row['route_id']] = row;
    }

    return output;
}

// Add new trip to DB, returns new id
async function addTrip(trip) {
    try {
        let id = await db_postgis.query(`INSERT INTO trips (route_id, route_id_id, trip_id, trip_headsign,
            trip_short_name, direction_id, block_id, wheelchair_accessible, bikes_allowed, shape_id, stops_info, stops, api,
            is_active) VALUES ('${trip.route_id}',  ${trip.route_id_id}, '${trip.trip_id}', '${trip.trip_headsign}',
            '${trip.trip_short_name}', ${trip.direction_id}, '${trip.block_id}', ${trip.wheelchair_accessible},
            ${trip.bikes_allowed}, ${trip.shape_id}, array[${trip.stops_info}]::json[], '{${trip.stops}}', '${trip.api}', true) RETURNING id`);
        return id.rows[0].id;
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Get all trips used in actual transit system state
async function getActiveTrips() {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, route_id, route_id_id, trip_id, trip_headsign,
            trip_short_name, direction_id, block_id, wheelchair_accessible, bikes_allowed, shape_id,
            stops_info, stops, api FROM trips WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let output = {};

    for (const row of result.rows) {
        output[row['trip_id']] = row;
    }

    return output;
}

// Add new shape to DB, returns new id
async function updateTripsShapeId(tripIds, shapeId) {
    try {
        await db_postgis.query(`UPDATE trips SET shape_id=${shapeId} WHERE is_active=true AND id IN (${tripIds})`);
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Add new shape to DB, returns new id
async function addShape(shape, route_type) {
    try {
        let id = await db_postgis.query(`INSERT INTO shapes (geom, route_type, is_active)
            VALUES ('{"type": "MultiLineString", "coordinates": ${JSON.stringify(shape)}}', '${route_type}', true) RETURNING id`);
        return id.rows[0].id;
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Send item to archive
async function makeObjUnActive(id, type) {
    try {
        await db_postgis.query(`UPDATE ${type} SET is_active=false WHERE id='${id}'`);
        return true;
    } catch(err) {
        console.log(err);
        return false;
    }
}

// Testing function for routing, will be deleted
async function getShapes() {
    let trips = await getActiveTrips();

    let stops = await getActiveStops();

    let sstops = [];
    for (const stop in stops) {
        sstops.push(stops[stop]);
    }

    let res = [];
    for (let trip in trips) {

        let stps = [];
        for (const s of trips[trip].stops) {

            let stp = sstops.find((stop) => {return s === stop.id});
            stps.push({
                code: stp.stop_id,
                latLng: stp.latLng
            })
        }
        res.push({
            route: trips[trip].route_id,
            shape: JSON.parse((await db_postgis.query(`SELECT ST_AsGeoJSON(geom) FROM shapes WHERE id='${trips[trip].shape_id}'`)).rows[0]['st_asgeojson']).coordinates,
            trip: trips[trip].trip_id.split('?')[2],
            stops: stps
        });
    }

    return res;
}

module.exports = { connectToDB, reloadNetFiles, addAgency, getActiveAgencies, addStop, getStopPositions,
    getActiveStops, addRoute, getActiveRoutes, addTrip, getActiveTrips, makeObjUnActive, addShape, updateTripsShapeId,
    getPointsAroundStation, getSubNet, getShapes }