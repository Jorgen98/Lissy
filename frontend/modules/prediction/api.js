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
    try {
        const today = timeStamp.getTimeStamp(timeStamp.getTodayUTC());
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
            // Get route trips
            case 'getTrips': {
                if (req.query.route === undefined) {
                    res.send(false);
                } else {
                    req.query.route = JSON.parse(req.query.route);
                    // Return today trips
                    if (today === req.query.date) {
                        const routeTrips = (await dbPostGIS.getPlannedTrips([req.query.route]))[0].trips;
                        res.send(await dbPostGIS.getTripsDetail(routeTrips.map((trip) => { return trip.id }), false));
                    // Return trips from another day
                    } else {
                        const actualDate = timeStamp.removeDayFromTimeStamp(req.query.date, 7);
                        const trips = await dbStats.getTripIdsInInterval(parseInt(req.query.route.id), actualDate, actualDate);
                        res.send(await dbPostGIS.getTripsDetail(trips, false));
                    }
                }
                break;
            }
            // Get prediction for exact trip
            case 'getPrediction': {
                const requestBody = {
                    visualization: true,
                    date: req.query.date,
                    depTime: req.query.dep_time,
                    method: req.query.method,
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
            // Get random trips for one day for testing purposes
            case 'getRandomTrips': {
                const key = req.url.split('&')[0];
console.log(key);
                const cache = await dbCache.setUpValue(key, null, null);
                const routes = await dbStats.getRoutesIdsInInterval(req.query.date, req.query.date);
                let selectedTrips = [];
                let stats;

                // Get random served trips
                if (cache.data !== null) {
                    ({selectedTrips, stats} = cache.data);
                } else {
                    const tripIdArrays = await Promise.all(
                        routes.map((route) =>
                            dbStats.getTripIdsInInterval(route, req.query.date, req.query.date)
                        )
                    );

                    const recordedTrips = tripIdArrays.flat();
                    ({result: selectedTrips, stats} = await dbPostGIS.chooseRandomTrips(recordedTrips));

                    dbCache.setUpValue(key, {selectedTrips, stats}, 100);
                }

                let idIdx = -1;

                try {
                    const tripIdFrom = parseInt(req.query.tripIdFrom);

                    if (selectedTrips[selectedTrips.length - 1].id < tripIdFrom) {
                        selectedTrips = [];
                    } else {
                        idIdx = selectedTrips.findIndex((trip) => { return trip.id > tripIdFrom });
                        if (idIdx !== -1) {
                            selectedTrips.splice(0, idIdx);
                        }
                    }
                } catch(err) {}

                // Only 1000 can be returned at once
                selectedTrips = selectedTrips.splice(0, 1000);

                // Get trips delay data
                const delayData = {};
                for (const route of routes) {
                    const tripGroup = selectedTrips.filter(trip => trip.route_id_id === route);

                    await Promise.all(
                        tripGroup.map(async (trip) => {
                            const tripDelayData = await dbStats.getTripDataInInterval(trip.id, req.query.date, req.query.date, true);
                            Object.assign(delayData, tripDelayData);
                        })
                    );
                }

                // Remove trips without data
                let idx = 0;
                while (idx < selectedTrips.length) {
                    const data = delayData[selectedTrips[idx].id];
                    if (data !== undefined) {
                        delete selectedTrips[idx].route_id_id;
                        selectedTrips[idx].delayData = Object.fromEntries(Object.entries(data).map(([key, { value }]) => [key, value]));
                        idx++
                    } else {
                        selectedTrips.splice(idx, 1);
                    }
                }
                stats['number_of_selected_trips_with_data'] = selectedTrips.length;
                res.send({stats: stats, trips: selectedTrips});
                break;
            }
            // Clear random selected trips
            case 'clearRandomTrips': {
                const key = req.url.replace("clearRandomTrips", "getRandomTrips").split('&')[0];
                await dbCache.clearCacheByKey(key);
                res.send(true);
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