/*
 * DB PostGIS function file
 */

const Pool = require('pg').Pool;
const dotenv = require('dotenv');
const fs = require('fs');

const logService = require('./log.js');
const dbStats = require('./db-stats.js');

// .env file include
dotenv.config();

let newNets = {
    rail: undefined,
    road: undefined,
    tram: undefined
}

let actualNetValid = {};

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
    port: 5432,
    connectionTimeoutMillis: 1000,
    max: 20
});


db_postgis.on('error', function(error) {
    log('info', `Connected clients: ${db_postgis.totalCount}, Idle clients: ${db_postgis.idleCount}`);
    log('error', error);
})

// Function for DB connection create
async function connectToDB() {
    try {
        let client = await db_postgis.connect();
        client.release(true);
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
    actualNetValid = {};

    try {
        actualNetValid = (await db_postgis.query(`SELECT * FROM net_stats`)).rows[0];
    } catch(error) {
        log('error', error);
        return false;
    }

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

    if (newNets['midpoints']) {
        if (!await reloadMidpoints(newNets['midpoints'])) {
            return false;
        }
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
                if (inputData.type && inputData.valid && (inputData.hubs || inputData.records)) {
                    if ((newNets[inputData.type] === undefined || new Date(inputData.valid) > new Date(newNets[inputData.type].valid)) &&
                        parseInt(actualNetValid[`${inputData.type}_valid`]) < (new Date(inputData.valid)).valueOf()) {
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
        await db_postgis.query(`UPDATE net_stats SET ${net}_valid=${(new Date(inputData.valid)).valueOf()}`);
        dbStats.updateStateProcessingStats(`${net}_net_actualized`, true);
        dbStats.updateStateProcessingStats(`${net}_net_hubs`, inputData.hubs.length);
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
    } catch(error) {
        log('error', error);
        return false;
    }

    let shapeIds;
    try {
        shapeIds = await db_postgis.query(`SELECT id, route_type FROM shapes WHERE is_active=true AND route_type='${net}'`);
    } catch(error) {
        log('error', error);
        return false;
    }

    let ids = [];
    for (const id of shapeIds?.rows) {
        ids.push(id.id);
    }

    if (ids.length > 0) {
        try {
            await db_postgis.query(`UPDATE trips SET is_active=false, is_today=false WHERE shape_id IN (${ids})`);
            await db_postgis.query(`UPDATE shapes SET is_active=false WHERE route_type='${net}'`);
        } catch(error) {
            log('error', error);
            return false;
        }
    }

    return true;
}

// Function for midpoints, used in shape creation, reloading
async function reloadMidpoints(inputData) {
    try {
        await db_postgis.query(`TRUNCATE TABLE midpoints RESTART IDENTITY`);
    } catch(error) {
        log('error', error);
        return false;
    }

    for (const record of inputData.records) {
        if (record.midpoints?.length > 0) {
            try {
            await db_postgis.query(`INSERT INTO midpoints (geom_stop_a, geom_stop_b, midpoints) VALUES (
                '{"type": "Point", "coordinates": ${JSON.stringify(record.endstopageom)}}',
                '{"type": "Point", "coordinates": ${JSON.stringify(record.endstopbgeom)}}',
                '{"type": "MultiLineString", "coordinates": [${JSON.stringify(record.midpoints)}]}')`);
            await db_postgis.query(`UPDATE net_stats SET midpoints_valid=${(new Date(inputData.valid)).valueOf()}`);

            dbStats.updateStateProcessingStats('midpoints_actualized', true);
            dbStats.updateStateProcessingStats('midpoints', 1);
            } catch(error) {
                log('error', error);
                return false;
            }
        }
    }

    log('success', `Midpoints data has been actualized`);
    return true;
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
    let centerPoint = [Math.abs(stopALatLng.latLng[0] + stopBLatLng.latLng[0]) / 2, Math.abs(stopALatLng.latLng[1] + stopBLatLng.latLng[1]) / 2];

    try {
        res = await db_postgis.query(`SELECT gid, conns, ST_AsGeoJSON(geom) FROM ${transportMode}
            WHERE ST_DistanceSphere(geom, '{"type": "Point", "coordinates": ${JSON.stringify(centerPoint)}}')
            <= ST_DistanceSpheroid('${stopALatLng.geom}', '${stopBLatLng.geom}') * ${netRadius}`);
    } catch(error) {
        log('error', error);
        return {};
    }

    let outputNet = {};
    for (let row of res.rows) {
        outputNet[row.gid] = {'pos': JSON.parse(row['st_asgeojson']).coordinates, 'conns': row.conns};
    }

    try {
        res = await db_postgis.query(`SELECT ST_AsGeoJSON(midpoints) FROM midpoints
            WHERE ST_DistanceSphere(geom_stop_a, '${stopALatLng.geom}') <= 1 AND
            ST_DistanceSphere(geom_stop_b, '${stopBLatLng.geom}') <= 1`);
    } catch(error) {
        log('error', error);
        return {
            subNet: {},
            midpoints: []
        }
    }

    if (res.rows?.length > 0) {
        let decRes = JSON.parse(res.rows[0]['st_asgeojson']).coordinates;
        let resMidpoints = [];

        for (const point of decRes[0]) {
            let pointGeom = '';

            try {
                pointGeom = (await db_postgis.query(`SELECT ST_MakePoint(${point[0]}, ${point[1]})`))?.rows[0]?.['st_makepoint'];
            } catch (err) {
                continue;
            }

            resMidpoints.push({
                latLng: point,
                geom: pointGeom
            })
        }

        return {
            subNet: outputNet,
            midpoints: resMidpoints
        }
    }

    return {
        subNet: outputNet,
        midpoints: []
    }
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

// Get all routes used in actual transit system state
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

// Get all routes used in actual transit system state for operation data processing
async function getActiveRoutesToProcess() {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, route_type, route_id, route_short_name, route_color FROM routes WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return [];
    }

    return result.rows;
}

// Add new trip to DB, returns new id
async function addTrip(trip) {
    try {
        let id = await db_postgis.query(`INSERT INTO trips (route_id, route_id_id, trip_id, trip_headsign,
            trip_short_name, direction_id, block_id, wheelchair_accessible, bikes_allowed, shape_id, stops_info, stops, api,
            is_active, is_today) VALUES ('${trip.route_id}',  ${trip.route_id_id}, '${trip.trip_id}', '${trip.trip_headsign}',
            '${trip.trip_short_name}', ${trip.direction_id}, '${trip.block_id}', ${trip.wheelchair_accessible},
            ${trip.bikes_allowed}, ${trip.shape_id}, array[${trip.stops_info}]::json[], '{${trip.stops}}', '${trip.api}', true, false) RETURNING id`);
        return id.rows[0].id;
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Get all trips used in actual transit system state
async function getActiveTrips(routeIds) {
    let result;

    let ids = [];
    for (const route in routeIds) {
        ids.push(routeIds[route].id);
    }

    try {
        result = await db_postgis.query(`SELECT id, route_id, route_id_id, trip_id, trip_headsign,
            trip_short_name, direction_id, block_id, wheelchair_accessible, bikes_allowed, shape_id,
            stops_info, stops, api FROM trips WHERE is_active=true AND route_id_id IN (${ids})`);
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

// Get all trips used in actual transit system state which will be served today
async function getPlannedTrips(routes) {
    let result;

    for (let route of routes) {
        try {
            result = await db_postgis.query(`SELECT id, api, shape_id, stops_info
                FROM trips WHERE is_active=true AND is_today=true AND route_id_id='${route.id}'`);
        } catch(error) {
            log('error', error);
            return [];
        }

        let trips_to_save = [];
        for (let trip of result.rows) {
            if (trip.stops_info.length < 2) {
                continue;
            }

            trip.stops_info = [trip.stops_info[0], trip.stops_info[trip.stops_info.length - 1]];
            trips_to_save.push(trip);
        }
        route.trips = trips_to_save;
    }

    let idx = 0;
    while (idx < routes.length) {
        if (routes[idx].trips.length < 1) {
            routes.splice(idx, 1);
        } else {
            idx++;
        }
    }

    return routes;
}

// Set all active trips as served, this function will be used before actual GTFS state processing
// This means there can be trips, which do not change at all (is_active), but they are not served on current day (is_today)
async function setAllTripAsServed() {
    try {
        await db_postgis.query(`UPDATE trips SET is_today=false WHERE is_active=true`);
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Set trip as served, means for today state data of this trip was processed
async function setTripAsServed(id) {
    try {
        await db_postgis.query(`UPDATE trips SET is_today=false WHERE id='${id}'`);
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Change trip state to will be served today
async function setTripAsUnServed(id) {
    try {
        await db_postgis.query(`UPDATE trips SET is_today=true WHERE id='${id}'`);
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Get all trips which will be served today and has different shape id
async function getPlannedTripsWithUniqueShape(routes, stopsOrder) {
    let result;
    let stops = {};
    try {
        result = await db_postgis.query(`SELECT id, stop_name FROM stops`);
        for (const stop of result.rows) {
            stops[stop.id] = stop.stop_name;
        }
    } catch(error) {
        log('error', error);
        return [];
    }

    routes.sort(sortRoutes);

    for (let route of routes) {
        try {
            result = await db_postgis.query(`SELECT * FROM ( SELECT shape_id, stops,
                ROW_NUMBER() OVER(PARTITION BY shape_id ORDER BY shape_id) AS row_number FROM trips 
                WHERE is_active=true AND is_today=true AND route_id_id='${route.id}') AS rows WHERE row_number = 1`);
        } catch(error) {
            log('error', error);
            return [];
        }

        let idx = 0;
        while (idx < result.rows.length) {
            if (result.rows.find((instTrip) => { return instTrip.stops.toString() === result.rows[idx].stops.toString() &&
                instTrip.shape_id !== result.rows[idx].shape_id })) {
                result.rows.splice(idx, 1);
            } else {
                idx++;
            }
        }

        let trips_to_save = [];
        for (let trip of result.rows) {
            if (trip.stops.length < 2) {
                continue;
            }

            if (stopsOrder) {
                let stopNamesOrder = [];
                for (const stop of trip.stops) {
                    stopNamesOrder.push(stops[stop]);
                }
    
                trip.stopOrder = stopNamesOrder;
            }

            trip.stops = `${stops[trip.stops[0]]} -> ${stops[trip.stops[trip.stops.length - 1]]}`;
            trips_to_save.push(trip);
            delete trip.row_number;
        }
        trips_to_save.sort((a, b) => {return a.stops > b.stops ? 1 : -1});
        route.trips = trips_to_save;
        delete route.id;
        delete route.route_id;
        delete route.route_type;
    }

    let idx = 0;
    while (idx < routes.length) {
        if (routes[idx].trips.length < 1) {
            routes.splice(idx, 1);
        } else {
            idx++;
        }
    }

    return routes;
}

// Get all trips according to trip ids and has different shape id
async function getTripsWithUniqueShape(tripIds, stopsOrder) {
    let result;
    let routes = [];
    let stops = {};

    if (tripIds.length < 1) {
        return [];
    }

    try {
        result = await db_postgis.query(`SELECT id, stop_name FROM stops`);
        for (const stop of result.rows) {
            stops[stop.id] = stop.stop_name;
        }
    } catch(error) {
        log('error', error);
        return [];
    }

    try {
        result = await db_postgis.query(`SELECT * FROM ( SELECT route_id_id, shape_id, stops,
            ROW_NUMBER() OVER(PARTITION BY shape_id ORDER BY shape_id) AS row_number FROM trips 
            WHERE id IN (${tripIds})) AS rows WHERE row_number = 1`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let idx = 0;
    while (idx < result.rows.length) {
        if (result.rows.find((instTrip) => { return instTrip.stops.toString() === result.rows[idx].stops.toString() &&
            instTrip.shape_id !== result.rows[idx].shape_id })) {
            result.rows.splice(idx, 1);
        } else {
            idx++;
        }
    }

    let trips_to_save = [];
    for (let trip of result.rows) {
        if (trip.stops.length < 2) {
            continue;
        }

        if (stopsOrder) {
            let stopNamesOrder = [];
            for (const stop of trip.stops) {
                stopNamesOrder.push(stops[stop]);
            }

            trip.stopOrder = stopNamesOrder;
        }

        trip.stops = `${stops[trip.stops[0]]} -> ${stops[trip.stops[trip.stops.length - 1]]}`;
        trips_to_save.push(trip);
        delete trip.row_number;
    }
    trips_to_save.sort((a, b) => {return a.stops > b.stops ? 1 : -1});

    for (const trip of trips_to_save) {
        let routeIdx = routes.findIndex((route) => {return route.route_id === trip.route_id_id});
        if (routeIdx === -1) {
            routes.push({
                route_id: trip.route_id_id,
                route_short_name: "",
                route_color: "",
                trips: []
            });
            routeIdx = routes.length - 1;
        }
        delete trip.route_id_id;
        routes[routeIdx].trips.push(trip);
    }

    let routeIds = routes.map((route) => route.route_id);
    let routeDetails;

    try {
        routeDetails = (await db_postgis.query(`SELECT id, route_type, route_short_name, route_color FROM routes WHERE id IN (${routeIds})`)).rows;
    } catch(error) {
        log('error', error);
        return [];
    }

    idx = 0;
    while (idx < routes.length) {
        if (routes[idx].trips.length < 1) {
            routes.splice(idx, 1);
        } else {
            let routeDetail = routeDetails.find((route) => { return route.id === routes[idx].route_id});
            routes[idx].route_short_name = routeDetail.route_short_name;
            routes[idx].route_color = routeDetail.route_color;
            idx++;
        }
    }

    routes.sort(sortRoutes);
    idx = 0;
    while (idx < routes.length) {
        delete routes[idx].route_id;
        delete routes[idx].route_type;
        idx++;
    }

    return routes;
}

// Return basic info about given routes by them id
async function getRoutesDetail(routeIds) {
    let routes = [];
    try {
        routes = (await db_postgis.query(`SELECT id, route_type, route_short_name FROM routes WHERE id IN (${routeIds})`)).rows;
    } catch(error) {
        log('error', error);
        return [];
    }

    routes.sort(sortRoutes);
    idx = 0;
    while (idx < routes.length) {
        delete routes[idx].route_type;
        idx++;
    }

    return routes;
}

// Return trips info by given id joined by shape id
async function getTripsDetail(tripIds) {
    let result;
    let stops = {};

    if (tripIds.length < 1) {
        return [];
    }

    try {
        result = await db_postgis.query(`SELECT id, stop_name FROM stops`);
        for (const stop of result.rows) {
            stops[stop.id] = stop.stop_name;
        }
    } catch(error) {
        log('error', error);
        return [];
    }

    try {
        result = await db_postgis.query(`SELECT id, shape_id, stops, stops_info FROM trips WHERE id IN (${tripIds})`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let tripGroups = [];
    for (let trip of result.rows) {
        if (trip.stops.length < 2) {
            continue;
        }

        let tripShapeId = tripGroups.findIndex((inspTrip) => {return inspTrip.shape_id === trip.shape_id});
        if (tripShapeId === -1) {
            tripShapeId = tripGroups.length;
            tripGroups.push({shape_id: trip.shape_id, stops: `${stops[trip.stops[0]]} -> ${stops[trip.stops[trip.stops.length - 1]]}`, trips: []});
        }

        trip.dep_time = (new Date(parseTimeFromGTFS(trip.stops_info[0].aT))).valueOf() + trip.stops_info[0].dT;
        delete trip.stops_info;
        delete trip.stops;
        delete trip.shape_id;
        tripGroups[tripShapeId].trips.push(trip);
    }

    for (let group of tripGroups) {
        group.trips.sort((a, b) => {return a.dep_time > b.dep_time ? 1 : -1});
    }

    tripGroups.sort((a, b) => {return a.stops > b.stops ? 1 : -1});

    return tripGroups;
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

// Return number of actual active shapes
async function countShapes() {
    try {
        let res = await db_postgis.query(`SELECT COUNT(id) FROM shapes WHERE is_active=true`);
        return parseInt(res.rows[0].count);
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Get all active shapes
async function getActiveShapes() {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, ST_AsGeoJSON(geom) FROM shapes WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return {};
    }

    let output = {};
    for (const row of result.rows) {
        let coords = [];
        try {
            coords = JSON.parse(row['st_asgeojson']).coordinates;
        } catch(error) {
            continue;
        }
        output[row.id] = coords;
    }

    return output;
}

// Get shape and its metadata
async function getFullShape(id) {
    let result;
    let trip;
    let stops;

    try {
        result = await db_postgis.query(`SELECT id, ST_AsGeoJSON(geom) FROM shapes WHERE id=${id}`);
        trip = (await db_postgis.query(`SELECT stops FROM trips WHERE shape_id=${id}`)).rows[0];

        if (trip === undefined) {
            return {};
        }

        stops = (await db_postgis.query(`SELECT id, stop_name, ST_AsGeoJSON(latLng), wheelchair_boarding,
            zone_id FROM stops WHERE id IN (${trip.stops})`)).rows;
    } catch(error) {
        log('error', error);
        return {};
    }

    let output = {};
    for (const row of result.rows) {
        let coords = [];
        try {
            coords = JSON.parse(row['st_asgeojson']).coordinates;
        } catch(error) {
            continue;
        }
        output['coords'] = coords;
    }

    output['stops'] = [];
    for (let stop of trip.stops) {
        let stopFromDB = stops.find((insStop) => {return insStop.id === stop});
        if (stopFromDB === undefined) {
            continue;
        }
        stopFromDB.coords = JSON.parse(stopFromDB.st_asgeojson).coordinates;
        delete stopFromDB.st_asgeojson;
        delete stopFromDB.id;
        output['stops'].push(stopFromDB);
    }

    return output;
}

// Send item to archive
async function makeObjUnActive(id, type) {
    try {
        let route_ids = [];
        if (type === 'agency') {
            await db_postgis.query(`UPDATE agency SET is_active=false WHERE id='${id}'`);
            route_ids = await db_postgis.query(`SELECT id FROM routes WHERE agency_id_id='${id}'`);
            route_ids = route_ids.rows.map((id) => {return id.id});
        }

        let trip_ids = [];
        if (type === 'routes') {
            route_ids = [id];
        }

        for (const route_id of route_ids) {
            await db_postgis.query(`UPDATE routes SET is_active=false WHERE id='${route_id}'`);
            let res = await db_postgis.query(`SELECT id FROM trips WHERE route_id_id='${route_id}'`);
            trip_ids = trip_ids.concat(res.rows.map((id) => {return id.id}));
        }

        if (type === 'stops') {
            await db_postgis.query(`UPDATE stops SET is_active=false WHERE id='${id}'`);
            let res = await db_postgis.query(`SELECT id FROM trips WHERE ${id} = ANY(stops)`);
            trip_ids = trip_ids.concat(res.rows.map((id) => {return id.id}));
        }

        if (type === 'trips') {
            trip_ids = [id];
        }

        let shape_ids = [];
        for (const trip_id of trip_ids) {
            await db_postgis.query(`UPDATE trips SET is_active=false WHERE id='${trip_id}'`);
            let shape_id = (await db_postgis.query(`SELECT shape_id FROM trips WHERE id='${trip_id}'`)).rows[0]?.shape_id;
            if (shape_id !== undefined && shape_id !== null && shape_ids.indexOf(shape_id) === -1) {
                shape_ids.push(shape_id);
            }
        }

        for (const shape_id of shape_ids) {
            if (parseInt((await db_postgis.query(`SELECT COUNT(id) FROM trips WHERE shape_id=${shape_id} AND is_active=true`)).rows[0].count) === 0) {
                await db_postgis.query(`UPDATE shapes SET is_active=false WHERE id='${shape_id}'`);
            }
        }

        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// This function return couple of latLngs, from which one is pointC and second is the point on line pointA -> pointB
// It is used to cut result shapes on segments according to stop positions
async function getShortestLine(pointA, pointB, pointC) {
    let result;
    try {
        result = await db_postgis.query(`SELECT ST_AsGeoJSON(  ST_ShortestLine('POINT (${pointC[0]} ${pointC[1]})',
            'LINESTRING (${pointA[0]} ${pointA[1]}, ${pointB[0]} ${pointB[1]})')) As line`);
    } catch(error) {
        log('error', error);
        return [];
    }

    if (result?.rows) {
        result = JSON.parse(result.rows[0]?.['line']).coordinates;

        if (JSON.stringify(result[0]) === JSON.stringify(pointC)) {
            return result[1];
        } else {
            return result[0];
        }
    }
}

// Function for testing purposes, return currently active shapes
async function getShapes() {
    let tripsDBOutput = [];
    try {
        tripsDBOutput = await db_postgis.query(`SELECT id, trip_id, route_id, trip_headsign, shape_id, stops FROM trips WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let trips = {};

    for (const row of tripsDBOutput.rows) {
        trips[row['trip_id']] = row;
    }

    let actualStops = await getActiveStops();

    let stopsArr = [];
    for (const stop in actualStops) {
        stopsArr.push(actualStops[stop]);
    }

    let output = [];
    for (let trip in trips) {
        let tripStops = [];
        let exists = true;
        for (const inspectedStop of trips[trip].stops) {
            let stop = stopsArr.find((stop) => {return inspectedStop === stop.id});

            if (stop === undefined) {
                exists = false;
                break;
            }

            tripStops.push({
                code: stop.stop_id,
                latLng: stop.latLng
            })
        }
        if (exists)
            output.push({
                route: trips[trip].route_id,
                shape: JSON.parse((await db_postgis.query(`SELECT ST_AsGeoJSON(geom) FROM shapes WHERE id='${trips[trip].shape_id}'`)).rows[0]['st_asgeojson']).coordinates,
                trip: trips[trip].trip_id.split('?')[2],
                stops: tripStops
        });
    }

    return output;
}

// Help function for route sorting according to its short names
function sortRoutes(routeA, routeB) {
    if (routeA.route_type > routeB.route_type) {
        return 1;
    } else if (routeA.route_type < routeB.route_type) {
        return -1;
    }
    
    return routeA.route_short_name.localeCompare(routeB.route_short_name, 'en', { sensitivity: 'base', numeric: true });
}

// Try to parse time from GTFS input data
function parseTimeFromGTFS(input) {
    try {
        if (parseInt(input.slice(0,2)) > 24) {
            input = `${(parseInt(input.slice(0,2)) - 24).toString()}:${input.slice(2,4)}:${input.slice(4,6)}`;
            return new Date(`1970-01-02T${input}`);
        } else {
            return new Date(`1970-01-01T${input}`);
        }
    } catch(error) {
        return new Date('1970-01-01T00:00:00');
    }
}

module.exports = { connectToDB, reloadNetFiles, addAgency, getActiveAgencies, addStop, getStopPositions,
    getActiveStops, addRoute, getActiveRoutes, addTrip, getActiveTrips, makeObjUnActive, addShape, updateTripsShapeId,
    getPointsAroundStation, getSubNet, getShapes, getShortestLine, countShapes, setAllTripAsServed, getPlannedTrips,
    setTripAsServed, setTripAsUnServed, getActiveRoutesToProcess, getActiveShapes, getPlannedTripsWithUniqueShape,
    getFullShape, getTripsWithUniqueShape, getRoutesDetail, getTripsDetail }