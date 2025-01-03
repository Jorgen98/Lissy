/*
 * API functions file
 */

const logService = require('../../../backend/log.js');
const dbStats = require('../../../backend/db-stats.js');
const dbPostGIS = require('../../../backend/db-postgis.js');

const env = require('./config.json');

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.FE_MODULE_NAME, type, msg)
}

// Main request processing function
async function processRequest(url, req, res) {
    try {
        switch (url[0]) {
            // Returns dates, when shapes are available
            case 'availableDates': {
                res.send(await dbStats.getAvailableDates());
                break;
            }
            // Return available routes for selected time interval
            case 'getAvailableRoutes': {
                if (req.query.dates === undefined) {
                    res.send(false);
                } else {
                    let response = {};
                    let dates = JSON.parse(req.query.dates);

                    // Get data for every date range
                    for (const pair of dates) {
                        let pairData = await dbStats.getRoutesIdsInInterval(pair[0], pair[1]);

                        for (const id of pairData) {
                            if (response[id] === undefined) {
                                response[id] = 0;
                            }
                            response[id]++;
                        }
                    }
                    for (const key in response) {
                        if (response[key] < dates.length) {
                            delete response[key];
                        }
                    }
                    res.send(await dbPostGIS.getRoutesDetail(Object.keys(response).map((item) => parseInt(item))));
                }
                break;
            }
            // Return available trips for selected route and time interval
            case 'getAvailableTrips': {
                if (req.query.dates === undefined || req.query.route_id === undefined) {
                    res.send(false);
                } else {
                    let response = {};
                    let dates = JSON.parse(req.query.dates);

                    // Get data for every date range
                    for (const pair of dates) {
                        let pairData = await dbStats.getTripIdsInInterval(parseInt(req.query.route_id), pair[0], pair[1]);

                        for (const id of pairData) {
                            if (response[id] === undefined) {
                                response[id] = 0;
                            }
                            response[id]++;
                        }
                    }
                    for (const key in response) {
                        if (response[key] < dates.length) {
                            delete response[key];
                        }
                    }
                    res.send(await dbPostGIS.getTripsDetail(Object.keys(response).map((item) => parseInt(item))));
                }
                break;
            }
            // Return full shape with stops and polyline for given shapeId
            case 'getShape': {
                if (req.query.shape_id === undefined) {
                    res.send(false);
                } else {
                    res.send(await dbPostGIS.getFullShape(req.query.shape_id));
                }
                break;
            }
            // Return available trip real operation data for selected tripId and time interval
            case 'getTripData': {
                if (req.query.dates === undefined || req.query.trip_id === undefined) {
                    res.send(false);
                } else {
                    let response = {};
                    let dates = JSON.parse(req.query.dates);

                    // Get data for every date range
                    for (const pair of dates) {
                        let pairData = await dbStats.getTripDataInInterval(parseInt(req.query.trip_id), pair[0], pair[1]);
                        for (const key in pairData) {
                            response[key] = pairData[key];
                        }
                    }
                    res.send(response);
                }
                break;
            }
            default: res.send(false);
        }
    } catch (error) {
        log('error', error);
        res.send(false);
    }
}

module.exports = { processRequest, env }