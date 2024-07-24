/*
 * DB Stats function file
 */

const { flux, InfluxDB } = require('@influxdata/influxdb-client');
const dotenv = require('dotenv');

const logService = require('./log.js');

// .env file include
dotenv.config();

// Stats DB instant
const db_influx = new InfluxDB({url: `${process.env.DB_STATS_HOST}:${process.env.DB_STATS_PORT}`, token: process.env.DB_STATS_TOKEN});

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.DB_STATS_MODULE_NAME, type, msg)
}

async function isDBConnected() {
    let dbQueryAPI = db_influx.getQueryApi(process.env.DB_STATS_ORG);
    let testQuery = flux`from(bucket: "${process.env.DB_STATS_BUCKET}") |> range(start: -1d) |> filter(fn: (r) => r._measurement != "")`;

    return new Promise((resolve) => {
        try {
            dbQueryAPI.queryRows(testQuery, {
                error(error) {
                    log('error', error);
                    resolve(false);
                },
                complete() {
                    resolve(true);
                },
            })
        } catch (error) {
            log('error', error);
            resolve(false);
        }
    });
}

module.exports = { isDBConnected }