/*
 * API functions file
 */

const logService = require('../../../backend/log.js');
const dbStats = require('../../../backend/db-stats.js');

const env = require('./config.json');

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.FE_MODULE_NAME, type, msg)
}

// Main request processing function
async function processRequest(url, req, res) {
    try {
        switch (url[0]) {
            // Returns dates, when stats are available
            case 'availableDates': {
                res.send(await dbStats.getAvailableDates());
                break;
            }
            // Returns stats for given date ranges
            case 'statistics': {
                if (req.query.dates === undefined) {
                    res.send(false);
                } else {
                    let response = {};
                    let dates = JSON.parse(req.query.dates);
                    const day = 24 * 60 * 60 * 1000;

                    // Get data for every date range
                    for (const pair of dates) {
                        // Get raw data
                        let realOperationData = await dbStats.getStats('operation_data_stats', pair[0] + day, pair[1] + day);
                        let expectedStateData = await dbStats.getStats('expected_state', pair[0], pair[1]);

                        // Couple real operations data and expected state data
                        for (const item in realOperationData) {
                            let date = (new Date(item)).setHours(0, 0, 0, 0) - day;

                            response[date] = {};

                            for (const stat in realOperationData[item]) {
                                response[date][stat] = realOperationData[item][stat];
                            }

                            response[date]['realOperationDataTimeStamp'] = (new Date(item)).valueOf();
                        }

                        for (const item in expectedStateData) {
                            let date = (new Date(item)).setHours(0, 0, 0, 0);

                            for (const stat in expectedStateData[item]) {
                                response[date][stat] = expectedStateData[item][stat];
                            }

                            response[date]['expectedStateDataTimeStamp'] = (new Date(item)).valueOf();
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