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
                res.send(await dbStats.getAvailableDates(true));
                break;
            }
            // Return available uniq shapeId for selected day
            case 'getShapes': {
                const fullStopsOrder = req.query.fullStopOrder === 'true' ? true : false;
                if (req.query.date === undefined) {
                    res.send(false);
                } else {
                    if (parseInt(req.query.date) === (new Date).setHours(0, 0, 0, 0).valueOf()) {
                        res.send(await dbPostGIS.getPlannedTripsWithUniqueShape(await dbPostGIS.getActiveRoutesToProcess(), fullStopsOrder));
                    } else {
                        let routes = await dbStats.getRoutesIdsInInterval(parseInt(req.query.date), parseInt(req.query.date));
                        let trips  = [];
                        for (const route of routes) {
                            trips = trips.concat(await dbStats.getTripIdsInInterval(route, parseInt(req.query.date), parseInt(req.query.date)));
                        }
                        res.send(await dbPostGIS.getTripsWithUniqueShape(trips, fullStopsOrder));
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
            default: res.send(false);
        }
    } catch (error) {
        log('error', error);
        res.send(false);
    }
}

module.exports = { processRequest, env }