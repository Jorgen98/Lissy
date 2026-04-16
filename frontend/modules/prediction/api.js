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
        switch (url[0]) {
            case 'getRoutes': {
                res.send(await dbPostGIS.getActiveRoutesToProcess());
                break;
            }
            case 'getTrips': {
                if (req.query.route_id === undefined) {
                    res.send(false);
                } else {
                    const routeTrips = (await dbPostGIS.getPlannedTrips([{id: parseInt(req.query.route_id)}]))[0].trips;
                    res.send(await dbPostGIS.getTripsDetail(routeTrips.map((trip) => { return trip.id }), false));
                }
                break;
            }
            case 'getPrediction': {
                const requestBody = {
                    visualization: true,
                    date: timeStamp.getTimeStamp(timeStamp.getTodayUTC()),
                    depTime: req.query.dep_time,
                    transport: {
                        line: req.query.line,
                        route: req.query.route
                    }
                };
                fetch('http://lissy-martin-prediction/predict', { //http://127.0.0.1:8000
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