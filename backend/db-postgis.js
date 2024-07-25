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
        await db_postgis.query(`INSERT INTO stops (stop_name, latLng, zone_id, parent_station, wheelchair_boarding, is_active) VALUES ('${stop.stop_name}',
            '{"type": "Point", "coordinates": [${stop.latLng}]}', ${stop.zone_id}, ${stop.parent_station}, ${stop.wheelchair_boarding}, true) RETURNING id`);
        return id.rows[0];
    } catch(error) {
        log('error', error);
        return null;
    }
}

async function getActiveStops() {
    let result;
    try {
        result = await db_postgis.query(`SELECT *, ST_AsGeoJSON(latLng) FROM stops WHERE is_active=true`);
    } catch(error) {
        log('error', error);
        return null;
    }

    console.log(result.rows);
}

module.exports = { connectToDB, reloadNetFiles, addStop, getActiveStops }