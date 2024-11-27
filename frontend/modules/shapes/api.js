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
            // Return available uniq shapeId for current day
            case 'getTodayShapes': {
                res.send(await dbPostGIS.getPlannedTripsWithUniqueShape(await dbPostGIS.getActiveRoutesToProcess()));
                break;
            }
            // Return available uniq shapeId for selected day
            case 'getShapes': {
                if (req.query.date === undefined) {
                    res.send(false);
                } else {
                    res.send(await dbPostGIS.getTripsWithUniqueShape(await dbStats.getTripIdsInInterval(parseInt(req.query.date), parseInt(req.query.date))));
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