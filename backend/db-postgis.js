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
        acState = await db_postgis.query("SELECT COUNT(gid) FROM " + net);
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
        await db_postgis.query("TRUNCATE TABLE " + net + " RESTART IDENTITY");
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Add new stop to DB, returns new id
async function addStop(stop) {
    try {
        let id = await db_postgis.query(`INSERT INTO stops (stop_id, stop_name, latLng, zone_id, parent_station, parent_station_id, wheelchair_boarding, is_active)
            VALUES ('${stop.stop_id}', '${stop.stop_name}', '{"type": "Point", "coordinates": ${JSON.stringify(stop.latLng)}}', '${stop.zone_id}', '${stop.parent_station}',
            ${stop.parent_station_id}, ${stop.wheelchair_boarding}, true) RETURNING id`);
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
        result = await db_postgis.query(`SELECT id, stop_id, stop_name, zone_id, parent_station,
            wheelchair_boarding, ST_AsGeoJSON(latLng) FROM stops WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return [];
    }

    let output = {};

    for (const row of result.rows) {
        row['latLng'] = JSON.parse(row['st_asgeojson']).coordinates;
        delete row['st_asgeojson'];
        output[row['stop_id']] = row;
    }

    return output;
}

// Add new line to DB, returns new id
async function addLine(line) {
    try {
        let id = await db_postgis.query(`INSERT INTO lines (route_id, agency_id, route_short_name, route_long_name,
            route_type, route_color, route_text_color, day_time, is_active) VALUES ('${line.route_id}', '${line.agency_id}',
            '${line.route_short_name}', '${line.route_long_name}', ${line.route_type}, '${line.route_color}', '${line.route_text_color}',
            ${line.day_time}, true) RETURNING id`);
        return id.rows[0].id;
    } catch(error) {
        log('error', error);
        return null;
    }
}

// Get all lines used in actual transit system state
async function getActiveLines() {
    let result;
    try {
        result = await db_postgis.query(`SELECT id, route_id, agency_id, route_short_name, route_long_name,
            route_type, route_color, route_text_color, day_time FROM lines WHERE is_active=true`);
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

module.exports = { connectToDB, reloadNetFiles, addStop, getActiveStops, addLine, getActiveLines, makeObjUnActive }