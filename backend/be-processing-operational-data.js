/*
 * BE Processing real operational data
 */

const https = require('https');
const dotenv = require('dotenv');

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');

let tripsToProcess = {};
let activeShapes = {};

const oneDay = 24 * 60 * 60 * 3600;
const now = new Date();
const yesterdayMidNight = new Date((new Date()).setHours(0, 0, 0, 0).valueOf() - oneDay);

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_OP_DATA_PROCESSING_MODULE_NAME, type, msg)
}

// Main processing function
async function processServedTrips() {
    if (!(await getTripsReadyToProcess())) {
        return false;
    }

    for (const route of tripsToProcess) {
        await processRoute(route);
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
        }
    }

    return true;
}

// Process one route trips
async function processRoute(route) {
    let lineIdString = route.route_id.split(/L|D/)[1];
    let inputOperationData = await downloadData(lineIdString, 0, 0);

    let dataToProcess = {};
    for (const record of inputOperationData) {
        if (record.attributes.isinactive === 'false') {
            if (dataToProcess[record.attributes.routeid] === undefined) {
                dataToProcess[record.attributes.routeid] = [];
            }

            dataToProcess[record.attributes.routeid].push({
                lat: record.attributes.lat,
                lng: record.attributes.lng,
                time: record.attributes.lastupdate
            })
        }
    }

    // To do: Parse data and save them
}

// Function for downloading data from Brno ArcGIS DB
async function downloadData(lineId, objectId, attempt) {
    let arcGISLinkStart = 'https://gis.brno.cz/ags1/rest/services/Hosted/ODAE_public_transit_positional_feature_service/FeatureServer/0/query?f=json&where=(';
    let arcGISLinkEnd = ')&returnGeometry=false&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=102100&resultOffset=0&resultRecordCount=10000';

    return new Promise(async (resolve) => {
        https.get(`${arcGISLinkStart} "lastupdate">${yesterdayMidNight.valueOf()} AND "lineid"=${lineId}
        AND "lastupdate"<${now.valueOf()} AND objectid>${objectId} ${arcGISLinkEnd}`, async res => {
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