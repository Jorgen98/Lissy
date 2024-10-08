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

let tripsToProcess = {};
let activeShapes = {};

const oneDay = 24 * 60 * 60 * 1000;
let now = new Date();
let yesterdayMidNight = new Date((new Date()).setHours(0, 0, 0, 0).valueOf() - oneDay);
let lastTripEnd = new Date(yesterdayMidNight.valueOf());

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_OP_DATA_PROCESSING_MODULE_NAME, type, msg)
}

// Main processing function
async function processServedTrips() {
    now = new Date();
    yesterdayMidNight = new Date((new Date()).setHours(0, 0, 0, 0).valueOf() - oneDay);
    lastTripEnd = new Date(yesterdayMidNight.valueOf());

    if (!(await getTripsReadyToProcess())) {
        log('error', 'Failed to load system structure data');
        return false;
    }

    for (const route of tripsToProcess) {
        if (!(await processRoute(route))) {
            log('error', 'Failed to process input real operation data');
            return false;
        };
    }

    return true;
}

// Function for preparing trips which can be now process
async function getTripsReadyToProcess() {
    activeShapes = await dbPostGIS.getActiveShapes();

    let activeRoutes = await dbPostGIS.getActiveRoutesToProcess();
    tripsToProcess = await dbPostGIS.getPlannedTrips(activeRoutes);

    // Remove trips, which do not finished yet
    let dateString = `${yesterdayMidNight.getFullYear()}-${yesterdayMidNight.getMonth() + 1}-${yesterdayMidNight.getDate()}`;
    for (let route of tripsToProcess) {
        let idx = 0;
        while (idx < route.trips.length) {
            let start = new Date([dateString, route.trips[idx].stops_info[0].aT]);
            let end = new Date(start.valueOf() + (route.trips[idx].stops_info[1].aT  * 1000));

            if (end.valueOf() > (now.valueOf() - parseInt(process.env.BE_OP_DATA_PROCESSING_TRIP_END_RESERVE) * 60 * 1000)) {
                route.trips.splice(idx, 1);
            } else {
                route.trips[idx].stops_info = [start, end];
                idx++;
            }

            if ((end.valueOf()) > lastTripEnd.valueOf()) {
                lastTripEnd = new Date(end.valueOf());
            }
        }
    }

    return true;
}

// Process one route trips
async function processRoute(route) {
    let lineIdString = route.route_id.split(/L|D/)[1];
    let inputOperationData = await downloadData(lineIdString, 0, 0);
    let testOutput = [];

    // Sort input records (operation data) from external DB according to trips
    let dataToProcess = {};
    for (const record of inputOperationData) {
        if (record.attributes.isinactive === 'false') {
            if (dataToProcess[record.attributes.routeid] === undefined) {
                dataToProcess[record.attributes.routeid] = [];
            }

            if (dataToProcess[record.attributes.routeid].length < 1 ||
                (dataToProcess[record.attributes.routeid][dataToProcess[record.attributes.routeid].length - 1].time -
                    record.attributes.lastupdate) < (parseInt(process.env.BE_OP_DATA_PROCESSING_TRIP_END_RESERVE) * 60 * 1000)) {
                dataToProcess[record.attributes.routeid].push({
                    lat: record.attributes.lat,
                    lng: record.attributes.lng,
                    time: record.attributes.lastupdate,
                    delay: record.attributes.delay
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

        if (tripShape === undefined || records === undefined) {
            await dbPostGIS.setTripAsServed(trip.id);
            continue;
        }

        records.sort((a, b) => {return a.time > b.time ? 1 : -1});

        for (let i = 0; i < tripShape.length; i++) {
            scoreTable.push(Array(tripShape[i].length).fill(null));
            testScoreTable.push(Array(tripShape[i].length).fill(null));
        }

        for (const record of records) {
            let score = Infinity;
            let position = [0, 0];
            for (let i = 0; i < tripShape.length; i++) {
                for (let j = 0; j < (tripShape[i].length - 1); j++) {
                    // Try to find the part of trip which the record belong
                    let acScore = routingService.triangulation(tripShape[i][j], tripShape[i][j + 1], [record.lat, record.lng]);
                    if (acScore < score) {
                        position = JSON.parse(JSON.stringify([i, j]));
                        score = acScore;
                    }
                }
            }

            if (score !== Infinity) {
                scoreTable[position[0]][position[1]] = record.delay;
                testScoreTable[position[0]][position[1]] = record;
            }
        }

        // Save parsed operation data intro stats DB
        if (!(await dbStats.saveRealOperationData(trip.id, scoreTable, trip.stops_info[0]))) {
            return false;
        }

        testOutput.push({trip: trip, shape: JSON.parse(JSON.stringify(tripShape)), delays: testScoreTable})

        //await dbPostGIS.setTripAsServed(trip.id);
    }

    fs.writeFile(`backups/${(new Date()).toLocaleString()}_real_operations_${route.route_id}_stats.txt`, JSON.stringify(testOutput, null, 4), function(err) {
        if (err) {
            console.log(err);
        }
    });

    // To do: real operation stats
    // create switch for test output

    return true;
}

// Function for downloading data from Brno ArcGIS DB
async function downloadData(lineId, objectId, attempt) {
    let arcGISLinkStart = 'https://gis.brno.cz/ags1/rest/services/Hosted/ODAE_public_transit_positional_feature_service/FeatureServer/0/query?f=json&where=(';
    let arcGISLinkEnd = ')&returnGeometry=false&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=102100&resultOffset=0&resultRecordCount=10000';

    console.log(lastTripEnd)
    return new Promise(async (resolve) => {
        https.get(`${arcGISLinkStart} "lastupdate">${yesterdayMidNight.valueOf()} AND "lineid"=${lineId}
        AND "lastupdate"<${lastTripEnd.valueOf() + parseInt(process.env.BE_OP_DATA_PROCESSING_TRIP_END_RESERVE) * 60 * 1000}
        AND objectid>${objectId} ${arcGISLinkEnd}`, async res => {
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
                    if (parsedData.features === undefined || parsedData.features.length < 1) {
                        resolve([]);
                    } else {
                        //let nextData = await downloadData(lineId, parsedData.features[parsedData.features.length - 1].attributes.objectid, 0);
                        //resolve(nextData.concat(parsedData.features));
                        resolve(parsedData.features)
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

module.exports = { processServedTrips }