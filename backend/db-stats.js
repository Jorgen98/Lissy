/*
 * DB Stats function file
 */

const { flux, InfluxDB, Point } = require('@influxdata/influxdb-client');
const { PingAPI, DeleteAPI } = require('@influxdata/influxdb-client-apis');
const fs = require('fs');
const dotenv = require('dotenv');

const logService = require('./log.js');

// .env file include
dotenv.config();

// Stats DB instant
const db_influx = new InfluxDB({url: `${process.env.DB_STATS_HOST}:8086`, token: process.env.DB_STATS_TOKEN, timeout: 30 * 1000});

// Measurement names
const measurementStats = 'stats';

// Stats measurement is divided by main tag intro sub measurements
const statType = {
    expectedState: 'expected_state', // actual GTFS processing stats
    tripsToProcess: 'trips_to_process', // how many trips should be still processed in current day
    operationData: 'operation_data', // Real operation processed data
    operationDataStats: 'operation_data_stats', // Real operation processing stats
    operationDataRoutes: 'operation_data_routes', // Routes metadata
    operationDataTrips: 'operation_data_trips' // Trips metadata
}

// Variable for transit system state processing stats
let stateProcessingStats = {};

// Variable for real operation processing stats
let realOperationProcessingStats = {};

const saveTestOutput = process.env.TEST_OUTPUTS === 'true' ? true : false;

const day = 24 * 60 * 60 * 1000;

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.DB_STATS_MODULE_NAME, type, msg)
}

async function isDBConnected() {
    const pingAPI = new PingAPI(db_influx);

    return new Promise((resolve) => {
        pingAPI.getPing()
            .then(async () => {
                await getStats(statType.expectedState, new Date((new Date()).valueOf() - 1000), new Date(), false);
                resolve(true);
            })
            .catch((error) => {
                log('error', error);
                resolve(false);
            })
    });
}

async function getStats(statType, start, stop, latest) {
    let startTime;
    let stopTime;
    try {
        startTime = new Date(start);
        stopTime = new Date(stop);
        stopTime = new Date(stopTime.setHours(23, 59, 59, 0));
    } catch (error) {
        return {};
    }

    let dbQueryAPI = db_influx.getQueryApi(process.env.DB_STATS_ORG);
    let testQuery;

    if (latest) {
        testQuery = flux`from(bucket: "${process.env.DB_STATS_BUCKET}")
        |> range(start: ${startTime}, stop: ${stopTime})
        |> filter(fn: (r) => r._measurement == ${measurementStats} and r.stat_type == ${statType})
        |> last()`;
    } else {
        testQuery = flux`from(bucket: "${process.env.DB_STATS_BUCKET}")
        |> range(start: ${startTime}, stop: ${stopTime})
        |> filter(fn: (r) => r._measurement == ${measurementStats} and r.stat_type == ${statType})`;
    }

    let records = {};

    return new Promise((resolve) => {
        dbQueryAPI.queryRows(testQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                if (records[o._time] === undefined) {
                    records[o._time] = {};
                }
                records[o._time][o._field] = o._value;
            },
            error(error) {
                log('error', error);
                resolve(false);
            },
            complete() {
                if (statType === 'operation_data_stats') {
                    let keys = Object.keys(records).sort();
                    let idx = 0;
                    while (keys.length > idx) {
                        if (Math.abs((new Date(keys[idx])).setHours(0, 0, 0, 0) - (new Date(keys[idx + 1])).setHours(0, 0, 0, 0)) < day) {
                            if (records[keys[idx]]['data_without_trips'] > records[keys[idx + 1]]['data_without_trips']) {
                                records[keys[idx]]['data_without_trips'] = records[keys[idx + 1]]['data_without_trips'];
                            }
                            if (records[keys[idx]]['downloaded_records'] < records[keys[idx + 1]]['downloaded_records']) {
                                records[keys[idx]]['downloaded_records'] = records[keys[idx + 1]]['downloaded_records'];
                            }
                            records[keys[idx]]['downloading_time'] += records[keys[idx + 1]]['downloading_time'];
                            records[keys[idx]]['parsing_time'] += records[keys[idx + 1]]['parsing_time'];
                            records[keys[idx]]['processing_time'] += records[keys[idx + 1]]['processing_time'];
                            records[keys[idx]]['stored_records'] += records[keys[idx + 1]]['stored_records'];
                            records[keys[idx]]['trips_without_data'] += records[keys[idx + 1]]['trips_without_data'];
                            delete records[keys[idx + 1]];
                            keys = Object.keys(records).sort();
                        } else {
                            idx++;
                        }
                    }
                }
                resolve(records);
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
        problematic_routes: [],
        trips_to_process: 0
    }
}

function initROProcessingStats() {
    realOperationProcessingStats = {
        is_db_available: false,
        processing_time: 0,
        downloading_time: 0,
        parsing_time: 0,
        downloaded_records: 0,
        stored_records: 0,
        trips_without_data: 0,
        data_without_trips: 0
    }
}

// Function for saving transit system processing stats intro DB
async function saveStateProcessingStats() {
    const writeApi = db_influx.getWriteApi(process.env.DB_STATS_ORG, process.env.DB_STATS_BUCKET);

    const record = new Point(measurementStats)
        .tag('stat_type', statType.expectedState)
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
        .intField('trips_to_process', stateProcessingStats['trips_to_process'])
        .timestamp(new Date());
        
    writeApi.writePoint(record)

    return new Promise((resolve) => {
        writeApi.close().then(() => {
            if (saveTestOutput) {
                fs.writeFile(`backups/${(new Date()).toISOString()}_gtfs_stats.txt`, JSON.stringify(stateProcessingStats, null, 4), function(error) {
                    if (error) {
                        log('error', error);
                    }
                });
            }
            resolve(true);
        })
        .catch((error) => {
            log('error', error)
            resolve(false);
        })
    });
}

// Function for saving transit system processing stats intro DB
async function saveROProcessingStats() {
    const writeApi = db_influx.getWriteApi(process.env.DB_STATS_ORG, process.env.DB_STATS_BUCKET);

    const record = new Point(measurementStats)
        .tag('stat_type', statType.operationDataStats)
        .tag('is_db_available', realOperationProcessingStats['is_db_available'])
        .intField('processing_time', realOperationProcessingStats['processing_time'])
        .intField('downloading_time', realOperationProcessingStats['downloading_time'])
        .intField('parsing_time', realOperationProcessingStats['parsing_time'])
        .intField('downloaded_records', realOperationProcessingStats['downloaded_records'])
        .intField('stored_records', realOperationProcessingStats['stored_records'])
        .intField('trips_without_data', realOperationProcessingStats['trips_without_data'])
        .intField('data_without_trips', realOperationProcessingStats['data_without_trips'])
        .timestamp(new Date());
        
    writeApi.writePoint(record)

    return new Promise((resolve) => {
        writeApi.close().then(() => {
            if (saveTestOutput) {
                fs.writeFile(`backups/${(new Date()).toISOString()}_ro_stats.txt`, JSON.stringify(realOperationProcessingStats, null, 4), function(error) {
                    if (error) {
                        log('error', error);
                    }
                });
            }
            resolve(true);
        })
        .catch((error) => {
            log('error', error)
            resolve(false);
        })
    });
}

// Function for saving transit system processing stats intro DB
async function saveRealOperationData(tripId, scoreTable, date) {
    const writeApi = db_influx.getWriteApi(process.env.DB_STATS_ORG, process.env.DB_STATS_BUCKET);

    let record = new Point(measurementStats)
        .tag('stat_type', statType.operationData)
        .tag('trip_id', tripId)
        .timestamp(date);
    
    let anyData = false;
    for (const [i, row] of scoreTable.entries()) {
        for (const [j, value] of row.entries()) {
            if (value !== null) {
                record.floatField(`${i}-${j}`, value);
                anyData = true;
            }
        }
    }
    record.tag('anyData', anyData);
        
    writeApi.writePoint(record);

    return new Promise((resolve) => {
        writeApi.close().then(async () => {
            resolve(true);
        })
        .catch((error) => {
            log('error', error)
            resolve(false);
        })
    });
}

// Function for saving transit system used routes intro DB
async function saveRealOperationRoutesData(ids, date) {
    const writeApi = db_influx.getWriteApi(process.env.DB_STATS_ORG, process.env.DB_STATS_BUCKET);

    let record = new Point(measurementStats)
        .tag('stat_type', statType.operationDataRoutes)
        .stringField('route_ids', ids)
        .timestamp(date);
        
    writeApi.writePoint(record);

    return new Promise((resolve) => {
        writeApi.close().then(async () => {
            resolve(true);
        })
        .catch((error) => {
            log('error', error)
            resolve(false);
        })
    });
}

// Function for saving transit system used trips intro DB
async function saveRealOperationTripsData(ids, route_id, date) {
    const writeApi = db_influx.getWriteApi(process.env.DB_STATS_ORG, process.env.DB_STATS_BUCKET);

    let record = new Point(measurementStats)
        .tag('stat_type', statType.operationDataTrips)
        .tag('route_id', route_id)
        .stringField('trip_ids', ids)
        .timestamp(date);
        
    writeApi.writePoint(record);

    return new Promise((resolve) => {
        writeApi.close().then(async () => {
            resolve(true);
        })
        .catch((error) => {
            log('error', error)
            resolve(false);
        })
    });
}

// Help function for updating system state processing stats
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

// Help function for updating real operation processing stats
function updateROProcessingStats(prop, value) {
    if (realOperationProcessingStats[prop] === undefined) {
        return;
    }

    switch (typeof(realOperationProcessingStats[prop])) {
        case 'number': realOperationProcessingStats[prop] += value; break;
        case 'boolean': realOperationProcessingStats[prop] = value; break;
    }
}

// Returns dates, when stats are available
// Record stamp for one date consist of expected state valid for that day and
// real operation data from next day
async function getAvailableDates(includeToday = false) {
    let startTime = new Date('2024-01-01');
    let stopTime = new Date();

    let dbQueryAPI = db_influx.getQueryApi(process.env.DB_STATS_ORG);
    let query;

    query = flux`from(bucket: "${process.env.DB_STATS_BUCKET}")
        |> range(start: ${startTime}, stop: ${stopTime})
        |> filter(fn: (r) => r._measurement == ${measurementStats} and r.stat_type == "operation_data_stats"
        and r._field == "trips_without_data")`;

    let records = [];

    return new Promise((resolve) => {
        dbQueryAPI.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                const date = (new Date(o._time)).setHours(0, 0, 0, 0) - day;
                if (records.indexOf(date) === -1) {
                    records.push(date);
                }
            },
            error(error) {
                log('error', error);
                resolve(false);
            },
            async complete() {
                if (includeToday) {
                    let yesterday = (new Date()).setHours(0, 0, 0, 0).valueOf();
                    if (Object.keys(await getStats('expected_state', yesterday, (new Date()).valueOf(), true)).length > 0) {
                        records.push((new Date()).setHours(0, 0, 0, 0));
                    }
                }
                if (records.length === 0) {
                    resolve({
                        start: (new Date).setHours(0, 0, 0, 0),
                        disabled: [(new Date).setHours(0, 0, 0, 0)],
                        end: (new Date).setHours(0, 0, 0, 0)
                    })
                } else if (records.length < 1) {
                    resolve({
                        start: records[0],
                        disabled: [],
                        end: records[0]
                    })
                } else {
                    records.sort();
                    let actualDate = records[0];
                    let disabledDates = [];
                    while (actualDate < (records[records.length - 1])) {
                        if (records.indexOf(actualDate) === -1) {
                            disabledDates.push(actualDate);
                        }
                        actualDate += day;
                    }
                    resolve({
                        start: records[0],
                        disabled: disabledDates,
                        end: records[records.length - 1]
                    })
                }
            },
        })
    });
}

// Help function for retrieving, which routes has been served in given time interval
async function getRoutesIdsInInterval(start, stop) {
    let startTime;
    let stopTime;
    try {
        startTime = new Date(start);
        stopTime = new Date(stop);
        stopTime = new Date(stopTime.setHours(23, 59, 59, 0));
    } catch (error) {
        return [];
    }

    let dbQueryAPI = db_influx.getQueryApi(process.env.DB_STATS_ORG);
    let query;

    query = flux`from(bucket: "${process.env.DB_STATS_BUCKET}")
    |> range(start: ${startTime}, stop: ${stopTime})
    |> filter(fn: (r) => r._measurement == ${measurementStats} and r.stat_type == ${statType.operationDataRoutes})`;

    let records = {};

    let max = 0;
    const day = 24 * 60 * 60 * 1000;
    let idx = 0;
    while (start <= (stop - idx * day)) {
        max++;
        idx++;
    }

    return new Promise((resolve) => {
        dbQueryAPI.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                const keys = JSON.parse(o._value);
                for (const key of keys) {
                    if (records[key] === undefined) {
                        records[key] = 0;
                    }
                    records[key]++;
                }
            },
            error(error) {
                log('error', error);
                resolve(false);
            },
            complete() {
                for (const key in records) {
                    if (records[key] < max) {
                        delete records[key];
                    }
                }
                resolve(Object.keys(records).map((item) => parseInt(item)));
            },
        })
    });
}

// Help function for retrieving, which trips has been server on give route in given time interval
async function getTripIdsInInterval(route_id, start, stop) {
    let startTime;
    let stopTime;
    try {
        startTime = new Date(start);
        stopTime = new Date(stop);
        stopTime = new Date(stopTime.setHours(23, 59, 59, 0));
    } catch (error) {
        return [];
    }

    let dbQueryAPI = db_influx.getQueryApi(process.env.DB_STATS_ORG);
    let query;

    query = flux`from(bucket: "${process.env.DB_STATS_BUCKET}")
    |> range(start: ${startTime}, stop: ${stopTime})
    |> filter(fn: (r) => r._measurement == ${measurementStats} and r.stat_type == ${statType.operationDataTrips} and r.route_id == ${route_id.toString()})`;

    let records = {};

    let max = 0;
    const day = 24 * 60 * 60 * 1000;
    let idx = 0;
    while (start <= (stop - idx * day)) {
        max++;
        idx++;
    }

    return new Promise((resolve) => {
        dbQueryAPI.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                let data = JSON.parse(o._value);
                for (const rec of data) {
                    if (records[rec] === undefined) {
                        records[rec] = 0;
                    }
                    records[rec]++;
                }
            },
            error(error) {
                log('error', error);
                resolve(false);
            },
            complete() {
                for (const key in records) {
                    if (records[key] < max) {
                        delete records[key];
                    }
                }
                resolve(Object.keys(records).map((item) => parseInt(item)));
            },
        })
    });
}

async function getTripDataInInterval(trip_id, start, stop) {
    let startTime;
    let stopTime;
    try {
        startTime = new Date(start);
        stopTime = new Date(stop);
        stopTime = new Date(stopTime.setHours(23, 59, 59, 0));
    } catch (error) {
        return [];
    }

    let dbQueryAPI = db_influx.getQueryApi(process.env.DB_STATS_ORG);
    let query;

    query = flux`from(bucket: "${process.env.DB_STATS_BUCKET}")
    |> range(start: ${startTime}, stop: ${stopTime})
    |> filter(fn: (r) => r._measurement == ${measurementStats} and r.stat_type == ${statType.operationData} and r.trip_id == ${trip_id.toString()})`;

    let records = {};

    return new Promise((resolve) => {
        dbQueryAPI.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                let dateKey = (new Date(o._time)).setHours(0, 0, 0, 0).valueOf();
                let primKey = parseInt(o._field.split('-')[0]);
                let secKey = parseInt(o._field.split('-')[1]);
                if (records[dateKey] === undefined) {
                    records[dateKey] = {};
                }
                if (records[dateKey][primKey] === undefined) {
                    records[dateKey][primKey] = {};
                }
                records[dateKey][primKey][secKey] = o._value;
            },
            error(error) {
                log('error', error);
                resolve(false);
            },
            complete() {
                resolve(records);
            },
        })
    });
}

module.exports = { isDBConnected, getStats, saveStateProcessingStats, initStateProcessingStats,
    updateStateProcessingStats, saveRealOperationData, initROProcessingStats,
    updateROProcessingStats, saveROProcessingStats, getAvailableDates, getRoutesIdsInInterval, getTripIdsInInterval,
    saveRealOperationRoutesData, saveRealOperationTripsData, getTripDataInInterval }