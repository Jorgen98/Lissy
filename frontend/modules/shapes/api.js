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
// Return all shapes with GTFS id for actual day
// Main request processing function
async function processRequest(url, req, res) {
    try {
        switch (url[0]) {
            // Returns dates, when shapes are available
            case 'availableDates': {
                res.send(await dbStats.getAvailableDates(true));
                break;
            }
            // Return available uniq shapeId for selected day
            case 'getShapes': {
                if (req.query.date === undefined) {
                    res.send(false);
                } else {
                    if (req.query.date === timeStamp.getTimeStamp(timeStamp.getTodayUTC())) {
                        const cache = await dbCache.getTodayShapes();

                        if (cache.data !== null) {
                            res.send(cache.data);
                        } else {
                            res.send(await dbCache.setUpTodayShapes());
                        }
                    } else {
                        let cache = await dbCache.setUpValue(req.url, null, null);

                        if (cache.data !== null) {
                            res.send(cache.data);
                        } else {
                            if (req.query.progress) {
                                res.send({progress: cache.progress});
                            }

                            if (cache.progress > 0 && req.query.progress) {
                                return;
                            }

                            let routes = await dbStats.getRoutesIdsInInterval(req.query.date, req.query.date);
                            let trips  = [];
                            for (const [idx, route] of routes.entries()) {
                                trips = trips.concat(await dbStats.getTripIdsInInterval(route, req.query.date, req.query.date));
                                dbCache.setUpValue(req.url, null, Math.floor((idx / routes.length) * 100));
                            }

                            if (!req.query.progress) {
                                res.send(await dbPostGIS.getTripsWithUniqueShape(trips));
                            }

                            dbCache.setUpValue(req.url, await dbPostGIS.getTripsWithUniqueShape(trips), 100);
                        }
                    }
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
            // Return full shapes for today
            case 'getTodayShapes': {
                if (req.query.gtfs_trips_from === undefined || req.query.gtfs_trips_to === undefined) {
                    res.send(false);
                } else {
                    try {
                        const from_id = parseInt(req.query.gtfs_trips_from);
                        const to_id = parseInt(req.query.gtfs_trips_to);

                        // Maximum number of queried trips is 5000
                        if (from_id > to_id || (Math.abs(from_id - to_id) > 5000)) {
                            res.send(false);
                            break;
                        }

                        res.send(await dbPostGIS.getTodayShapes(from_id, to_id, req.query.switchCoords, req.query.reduceCoords));
                    } catch (err) {
                        res.send(false);
                    }
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