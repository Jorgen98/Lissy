/*
 * DB PostGIS function file
 */

const Pool = require('pg').Pool;
const dotenv = require('dotenv');

const logService = require('./log.js');

// .env file include
dotenv.config();

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

async function connectToDB() {
    try {
        await db_postgis.connect();
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

module.exports = { connectToDB }