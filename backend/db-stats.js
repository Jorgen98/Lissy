/*
 * DB Stats function file
 */

const dotenv = require('dotenv');
const { flux, InfluxDB } = require('@influxdata/influxdb-client');

// .env file include
dotenv.config();

// Stats DB instant
const db = new InfluxDB({url: `${process.env.DB_STATS_HOST}:${process.env.DB_STATS_PORT}`, token: process.env.DB_STATS_TOKEN});

async function isDBConnected() {
    let dbQueryAPI = db.getQueryApi(process.env.DB_STATS_ORG);
    let testQuery = flux`from(bucket: "${process.env.DB_STATS_BUCKET}") |> range(start: -1d) |> filter(fn: (r) => r._measurement != "")`;

    return new Promise((resolve) => {
        try {
            dbQueryAPI.queryRows(testQuery, {
                error(error) {
                    console.error(error)
                    resolve(false);
                },
                complete() {
                    resolve(true);
                },
            })
        } catch (error) {}
    });
}

module.exports = { isDBConnected }