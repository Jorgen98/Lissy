/*
 * DB Stats function file
 */

const { flux, InfluxDB, Point } = require('@influxdata/influxdb-client');
const { PingAPI, DeleteAPI } = require('@influxdata/influxdb-client-apis');
const dotenv = require('dotenv');

const logService = require('./log.js');

// .env file include
dotenv.config();

// Stats DB instant
const db_influx = new InfluxDB({url: `${process.env.DB_STATS_HOST}:${process.env.DB_STATS_PORT}`, token: process.env.DB_STATS_TOKEN});

// Measurement names
const measurementStats = 'stats';

// Variable for transit system state processing stats
let stateProcessingStats = {};

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.DB_STATS_MODULE_NAME, type, msg)
}

async function isDBConnected() {
    const pingAPI = new PingAPI(db_influx);

    return new Promise((resolve) => {
        pingAPI.getPing()
            .then(async () => {
                await getStats();
                resolve(true);
            })
            .catch((error) => {
                log('error', error);
                resolve(false);
            })
    });
}

async function getStats() {
    let dbQueryAPI = db_influx.getQueryApi(process.env.DB_STATS_ORG);
    let testQuery = flux`from(bucket: "${process.env.DB_STATS_BUCKET}") |> range(start: -1d) |> filter(fn: (r) => r._measurement != "")`;

    return new Promise((resolve) => {
        dbQueryAPI.queryRows(testQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row)
                console.log(`${o._time} ${o._measurement}: ${o._field}=${o._value}`)
            },
            error(error) {
                log('error', error);
                resolve(false);
            },
            complete() {
                resolve(true);
            },
        })
    });
}

function initStateProcessingStats() {
    stateProcessingStats = {
        rail_net_actualized: false,
        rail_net_hubs: 0,
        road_net_actualized: false,
        road_net_hubs: 0,
        tram_net_actualized: false,
        tram_net_hubs: 0,
        midpoints_actualized: false,
        midpoints: 0,
        gtfs_file_downloaded: false,
        gtfs_agencies: 0,
        gtfs_agencies_added: 0,
        gtfs_stops: 0,
        gtfs_stops_added: 0,
        gtfs_routes: 0,
        gtfs_routes_added: 0,
        gtfs_trips: 0,
        gtfs_trips_added: 0,
        gtfs_shapes: 0,
        gtfs_shapes_added: 0,
        gtfs_processing_time: 0,
        routing_done: false,
        routing_rail_total: 0,
        routing_rail_success: 0,
        routing_road_total: 0,
        routing_road_success: 0,
        routing_tram_total: 0,
        routing_tram_success: 0,
        routing_time: 0,
        problematic_routes: []
    }
}

// Function for saving transit system processing stats intro DB
async function saveStateProcessingStats() {
    const writeApi = db_influx.getWriteApi(process.env.DB_STATS_ORG, process.env.DB_STATS_BUCKET);

    const deleteAPI = new DeleteAPI(db_influx)
    const stop = new Date()
    let start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    await deleteAPI.postDelete({
        org: process.env.DB_STATS_ORG,
        bucket: process.env.DB_STATS_BUCKET,
        body: {
            start: start.toISOString(),
            stop: stop.toISOString(),
            predicate: `_measurement="${measurementStats}"`,
        },
    })

    const record = new Point(measurementStats)
        .tag('stat_type', 'expected_state')
        .tag('gtfs_file', stateProcessingStats['gtfs_file_downloaded'])
        .tag('routing', stateProcessingStats['routing_done'])
        .booleanField('rail_net_actualized', stateProcessingStats['rail_net_actualized'])
        .intField('rail_net_hubs', stateProcessingStats['rail_net_hubs'])
        .booleanField('road_net_actualized', stateProcessingStats['road_net_actualized'])
        .intField('road_net_hubs', stateProcessingStats['road_net_hubs'])
        .booleanField('tram_net_actualized', stateProcessingStats['tram_net_actualized'])
        .intField('tram_net_hubs', stateProcessingStats['tram_net_hubs'])
        .booleanField('midpoints_actualized', stateProcessingStats['midpoints_actualized'])
        .intField('midpoints', stateProcessingStats['midpoints'])
        .booleanField('gtfs_file_downloaded', stateProcessingStats['gtfs_file_downloaded'])
        .intField('gtfs_agencies', stateProcessingStats['gtfs_agencies'])
        .intField('gtfs_agencies_added', stateProcessingStats['gtfs_agencies_added'])
        .intField('gtfs_stops', stateProcessingStats['gtfs_stops'])
        .intField('gtfs_stops_added', stateProcessingStats['gtfs_stops_added'])
        .intField('gtfs_routes', stateProcessingStats['gtfs_routes'])
        .intField('gtfs_routes_added', stateProcessingStats['gtfs_routes_added'])
        .intField('gtfs_trips', stateProcessingStats['gtfs_trips'])
        .intField('gtfs_trips_added', stateProcessingStats['gtfs_trips_added'])
        .intField('gtfs_shapes', stateProcessingStats['gtfs_shapes'])
        .intField('gtfs_shapes_added', stateProcessingStats['gtfs_shapes_added'])
        .intField('gtfs_processing_time', stateProcessingStats['gtfs_processing_time'])
        .booleanField('routing_done', stateProcessingStats['routing_done'])
        .intField('routing_rail_total', stateProcessingStats['routing_rail_total'])
        .intField('routing_rail_success', stateProcessingStats['routing_rail_success'])
        .intField('routing_road_total', stateProcessingStats['routing_road_total'])
        .intField('routing_road_success', stateProcessingStats['routing_road_success'])
        .intField('routing_tram_total', stateProcessingStats['routing_tram_total'])
        .intField('routing_tram_success', stateProcessingStats['routing_tram_success'])
        .intField('routing_time', stateProcessingStats['routing_time'])
        .stringField('problematic_routes', JSON.stringify(stateProcessingStats['problematic_routes']))
        .timestamp(new Date());
        
    writeApi.writePoint(record)

    return new Promise((resolve) => {
        writeApi.close().then(() => {
            resolve(true);
        })
        .catch((error) => {
            log('error', error)
            resolve(false);
        })
    });
}

function updateStateProcessingStats(prop, value) {
    if (stateProcessingStats[prop] === undefined) {
        return;
    }

    switch (typeof(stateProcessingStats[prop])) {
        case 'number': stateProcessingStats[prop] += value; break;
        case 'boolean': stateProcessingStats[prop] = value; break;
        default: stateProcessingStats[prop].push(value);
    }
}

module.exports = { isDBConnected, saveStateProcessingStats, initStateProcessingStats, updateStateProcessingStats }