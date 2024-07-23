/*
 * DB PostGIS function file
 */

const dotenv = require('dotenv');
const Pool = require('pg').Pool;

// .env file include
dotenv.config();

// PostGIS DB instant
const db = new Pool({
    user: process.env.DB_POSTGIS_USER,
    host: process.env.DB_POSTGIS_HOST,
    database: process.env.DB_POSTGIS_DATABASE,
    password: process.env.DB_POSTGIS_PASSWORD,
    port: process.env.DB_POSTGIS_PORT
});

async function connect() {
    try {
        await db.connect();
        return db;
    } catch(error) {
        console.log(error);
        return null;
    }
}

async function isDBConnected() {
    return (await connect() !== null);
}

module.exports = { connect, isDBConnected }