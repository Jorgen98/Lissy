/*
 * API functions file
 */

const logService = require('../../../backend/log.js');
const dbStats = require('../../../backend/db-stats.js');
const dbPostGIS = require('../../../backend/db-postgis.js');
const dbCache = require('../../../backend/db-cache.js');
const timeStamp = require('../../../backend/timeStamp.js');

const env = require('./config.json');

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.FE_MODULE_NAME, type, msg)
}

// Main request processing function
async function processRequest(url, req, res) {
    const today = timeStamp.getTimeStamp(timeStamp.getTodayUTC());
    try {
        switch (url[0]) {
            case 'getRoutes': {
                // Return today routes
                if (today === req.query.date) {
                    res.send(await dbPostGIS.getActiveRoutesToProcess());
                // Return routes from another day
                } else {
                    const actualDate = timeStamp.removeDayFromTimeStamp(req.query.date, 7);
                    res.send(await dbPostGIS.getRoutesDetail(await dbStats.getRoutesIdsInInterval(actualDate, actualDate)));
                }
                break;
            }
            case 'getTrips': {
                if (req.query.route_id === undefined) {
                    res.send(false);
                } else {
                    // Return today trips
                    if (today === req.query.date) {
                        const routeTrips = (await dbPostGIS.getPlannedTrips([{id: parseInt(req.query.route_id)}]))[0].trips;
                        res.send(await dbPostGIS.getTripsDetail(routeTrips.map((trip) => { return trip.id }), false));
                    // Return trips from another day
                    } else {
                        const actualDate = timeStamp.removeDayFromTimeStamp(req.query.date, 7);
                        const trips = await dbStats.getTripIdsInInterval(parseInt(req.query.route_id), actualDate, actualDate);
                        res.send(await dbPostGIS.getTripsDetail(trips, false));
                    }
                }
                break;
            }
            case 'getPrediction': {
                const requestBody = {
                    visualization: true,
                    date: req.query.date,
                    depTime: req.query.dep_time,
                    transport: {
                        line: req.query.line,
                        route: req.query.route
                    }
                };
                fetch(`${process.env.BE_PREDICTION_URL}/predict`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                })
                .then(res => res.json())
                .then(data => res.send({
                    predictionResponse: data,
                    requestBody: requestBody
                }))
                .catch(err => {
                    log('error', err);
                    res.send(false);
                });
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
            default: res.send(false);
        }
    } catch (error) {
        log('error', error);

        if (!res.finished) {
            res.send(false);
        }

        if (req.query.progress) {
            dbCache.setUpValue(req.url, false, 100);
        }
    }
}

module.exports = { processRequest, env }