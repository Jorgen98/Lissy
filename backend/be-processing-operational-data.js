/*
 * BE Processing real operational data
 */

const https = require('https');
const dotenv = require('dotenv');
const fs = require('fs');

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');
const routingService = require('./routing.js');
const timeStamp = require('./timeStamp.js');

let tripsToProcess = {};
let activeShapes = {};
let numOfTripsToProcess = 0;
let progress = 0;
let lastProgressValue = 0;

const oneDay = 24 * 60 * 60 * 1000;
let now = timeStamp.getTodayUTC();
let yesterdayMidNight = timeStamp.getDateFromTimeStamp(timeStamp.removeOneDayFromTimeStamp(timeStamp.getTimeStamp(now.setUTCHours(0, 0, 0, 0))));
let lastTripEnd = timeStamp.getDateFromTimeStamp(timeStamp.getTimeStamp(yesterdayMidNight));

const saveTestOutput = process.env.TEST_OUTPUTS === 'true' ? true : false;

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_OP_DATA_PROCESSING_MODULE_NAME, type, msg)
}

// Main processing function
async function processServedTrips() {
    log('info', 'Starting to process real operation data');
    dbStats.initROProcessingStats();

    let startTime = performance.now();
    now = timeStamp.getTodayUTC();
    yesterdayMidNight = timeStamp.getDateFromTimeStamp(timeStamp.removeOneDayFromTimeStamp(timeStamp.getTimeStamp(now.setUTCHours(0, 0, 0, 0))));
    now = timeStamp.getTodayUTC();
    lastTripEnd = timeStamp.getDateFromTimeStamp(timeStamp.getTimeStamp(yesterdayMidNight));

    // Prepare trips, which should been processed
    log('info', 'Preparing system state data');
    if (!(await getTripsReadyToProcess())) {
        log('error', 'Failed to load system structure data');
        return false;
    }

    // Try to connect to Brno ArcGIS DB
    log('info', 'Downloading and storing data from Brno ArcGIS DB');
    if (!await isDBAlive()) {
        dbStats.updateROProcessingStats('is_db_available', false);
        log('info', 'Brno ArcGIS DB is not available');
    } else {
        dbStats.updateROProcessingStats('is_db_available', true);
    }

    if (!(await dbStats.saveRealOperationRoutesData(JSON.stringify(tripsToProcess.map((item) => item.id)), yesterdayMidNight))) {
        return false;
    }

    // Try to parse and save data downloaded from Brno ArcGIS DB
    progress = 0;
    lastProgressValue = 0;
    for (const route of tripsToProcess) {
        if (!(await processRoute(route))) {
            log('error', 'Failed to process input real operation data');
            continue;
        };
    }

    dbStats.updateROProcessingStats('processing_time', performance.now() - startTime);
    await dbStats.saveROProcessingStats();

    log('success', 'Real operation data processing has finished');
    return true;
}

// Function for preparing trips which can be now process
async function getTripsReadyToProcess() {
    activeShapes = await dbPostGIS.getActiveShapes();
    numOfTripsToProcess = 0;

    let activeRoutes = await dbPostGIS.getActiveRoutesToProcess();
    tripsToProcess = await dbPostGIS.getPlannedTrips(activeRoutes);

    // Remove trips, which do not finished yet
    for (let route of tripsToProcess) {
        let idx = 0;
        while (idx < route.trips.length) {
            let start = new Date(Date.UTC(yesterdayMidNight.getUTCFullYear(), yesterdayMidNight.getUTCMonth(), yesterdayMidNight.getUTCDate(),
                route.trips[idx].stops_info[0].aT.slice(0, 2), route.trips[idx].stops_info[0].aT.slice(3, 5), route.trips[idx].stops_info[0].aT.slice(6, 7), 0));
            let end = new Date(start.getTime() + (route.trips[idx].stops_info[1].aT  * 1000));

            if (end.getTime() > (now.getTime() - parseInt(process.env.BE_OP_DATA_PROCESSING_TRIP_END_RESERVE) * 60 * 1000 - (now.getTimezoneOffset() * 60 * 1000))) {
                route.trips.splice(idx, 1);
            } else {
                route.trips[idx].stops_info = [start, end];
                idx++;
                numOfTripsToProcess++;
            }

            if ((end.getTime()) > lastTripEnd.getTime()) {
                lastTripEnd = end;
            }
        }
    }

    return true;
}

// Process one route trips
async function processRoute(route) {
    let lineIdString = route.route_id.split(/L|D/)[1];

    let startTime = performance.now();
    let inputOperationData = await downloadData(lineIdString, 0, 0);
    dbStats.updateROProcessingStats('downloading_time', performance.now() - startTime);
    let testOutput = [];

    // Sort input records (operation data) from external DB according to trips
    startTime = performance.now();
    dbStats.updateROProcessingStats('downloaded_records', inputOperationData.length);
    let dataToProcess = {};
    for (const record of inputOperationData) {
        if (record.isinactive === 'false') {
            if (dataToProcess[record.routeid] === undefined) {
                dataToProcess[record.routeid] = [];
            }

            if (dataToProcess[record.routeid].length < 1 ||
                (dataToProcess[record.routeid][dataToProcess[record.routeid].length - 1].time -
                    record.lastupdate) < (parseInt(process.env.BE_OP_DATA_PROCESSING_TRIP_END_RESERVE) * 60 * 1000)) {
                dataToProcess[record.routeid].push({
                    lat: record.lat,
                    lng: record.lng,
                    time: record.lastupdate,
                    delay: record.delay
                })
            }
        }
    }

    // Parse records to exact part of trip
    for (const trip of route.trips) {
        let tripShape = activeShapes[trip.shape_id];
        let records = dataToProcess[trip.api];
        let scoreTable = [];
        let testScoreTable = [];
        let testInfScoreTable = [];

        if (tripShape === undefined || records === undefined) {
            if (!(await dbStats.saveRealOperationData(trip.id, scoreTable, trip.stops_info[0]))) {
                return false;
            }
            dbStats.updateROProcessingStats('trips_without_data', 1);
            await dbPostGIS.setTripAsServed(trip.id);
            continue;
        }

        records.sort((a, b) => {return a.time > b.time ? 1 : -1});

        for (let i = 0; i < tripShape.length; i++) {
            scoreTable.push(Array(tripShape[i].length).fill(null));
            if (saveTestOutput) {
                testScoreTable.push(Array(tripShape[i].length).fill(null));
            }
        }

        for (const record of records) {
            let score = Infinity;
            let position = [0, 0];
            for (let i = 0; i < tripShape.length; i++) {
                for (let j = 0; j < (tripShape[i].length - 1); j++) {
                    // Try to find the part of trip which the record belong
                    let acScore = routingService.triangulationWithDistControl(tripShape[i][j], tripShape[i][j + 1], [record.lat, record.lng]);
                    if (acScore < score) {
                        position = JSON.parse(JSON.stringify([i, j]));
                        score = acScore;
                    }
                }
            }

            // Save record to that part of trip, which has the best matching score
            if (score !== Infinity) {
                scoreTable[position[0]][position[1]] = record.delay;
                if (saveTestOutput) {
                    testScoreTable[position[0]][position[1]] = record;
                }
                dbStats.updateROProcessingStats('stored_records', 1);
            } else {
                testInfScoreTable.push(record);
            }
        }

        // Save parsed operation data intro stats DB
        if (!(await dbStats.saveRealOperationData(trip.id, scoreTable, trip.stops_info[0]))) {
            return false;
        }

        if (saveTestOutput) {
            testOutput.push({trip: trip, shape: JSON.parse(JSON.stringify(tripShape)), delays: testScoreTable, noScore: testInfScoreTable});
        }

        await dbPostGIS.setTripAsServed(trip.id);

        progress += (1 / numOfTripsToProcess) * 100;
        if (Math.floor(progress) > lastProgressValue) {
            lastProgressValue = Math.floor(progress);
            log('info', `Saving records, progress: ${lastProgressValue}%`);
        }

        delete dataToProcess[trip.api];
    }

    if (saveTestOutput) {
        fs.writeFile(`backups/${(new Date()).toISOString()}_real_operations_${route.route_id}_stats.txt`, JSON.stringify(testOutput, null, 4), function(error) {
            if (error) {
                log('error', error);
            }
        });
    }

    if (!(await dbStats.saveRealOperationTripsData(JSON.stringify(route.trips.map((item) => item.id)), route.id, yesterdayMidNight))) {
        return false;
    }

    dbStats.updateROProcessingStats('data_without_trips', Object.keys(dataToProcess).length);
    dbStats.updateROProcessingStats('parsing_time', performance.now() - startTime);
    return true;
}

// Function for downloading data from Brno ArcGIS DB
async function downloadData(lineId, objectId, attempt) {
    // Example DB query
    // https://walter.fit.vutbr.cz/ben/records?object_id=1&line_id=1&from=1758015083523&to=1758306424823

    return new Promise(async (resolve) => {
        https.get({
            hostname: "walter.fit.vutbr.cz",
            path: `/ben/records?object_id=${objectId}&line_id=${lineId}&from=${yesterdayMidNight.getTime()}&to=${lastTripEnd.getTime() + parseInt(process.env.BE_OP_DATA_PROCESSING_TRIP_END_RESERVE) * 60 * 1000}`,
            headers: {
                authorization: process.env.BE_OP_DATA_PROCESSING_BEN_TOKEN,
            },
        }, async res => {
            let { statusCode } = res;
            let contentType = res.headers['content-type'];

            if (statusCode !== 200) {
                log('error', 'Wrong response status code');
                resolve([]);
                return;
            } else if (!/^application\/json/.test(contentType)) {
                log('error', 'Invalid response content type');
                resolve([]);
                return;
            }

            res.setEncoding('utf8');
            let rawData = '';

            res.on('data', (chunk) => {
                rawData += chunk;
            });

            res.on('end', async () => {
                try {
                    const parsedData = JSON.parse(rawData);
                    if (parsedData === undefined || parsedData.length < 1) {
                        resolve([]);
                    } else {
                        let nextData = await downloadData(lineId, parsedData[parsedData.length - 1].objectid, 0);
                        resolve(nextData.concat(parsedData));
                    }
                } catch (e) {
                    resolve([]);
                }
            });
        })
        .on('error', async error => {
            log('error', error);
            if (attempt < 5) {
                resolve(await downloadData(lineId, objectId, attempt + 1));
            } else {
                resolve([]);
            }
        });
    });
}

// Help function for check, if Brno ArcGIS DB is online
async function isDBAlive() {
    let arcGISLinkStart = 'https://gis.brno.cz/ags1/rest/services/Hosted/ODAE_public_transit_positional_feature_service/FeatureServer/0/query?f=json&where=(';
    let arcGISLinkEnd = ')&returnGeometry=false&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=102100&resultOffset=0&resultRecordCount=10000';

    return new Promise(async (resolve) => {
        https.get(`${arcGISLinkStart} objectid>0 ${arcGISLinkEnd}`, async res => {
            let { statusCode } = res;
            let contentType = res.headers['content-type'];

            if (statusCode !== 200) {
                log('error', 'Wrong response status code');
                resolve(false);
                return;
            } else if (!/^application\/json/.test(contentType)) {
                log('error', 'Invalid response content type');
                resolve(false);
                return;
            }

            res.setEncoding('utf8');
            let rawData = '';

            res.on('data', (chunk) => {
                rawData += chunk;
            });

            res.on('end', async () => {
                resolve(true);
            });
        })
        .on('error', async error => {
            log('error', error);
            resolve(false);
        });
    });
}

module.exports = { processServedTrips }