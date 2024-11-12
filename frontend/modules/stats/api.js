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

async function processRequest(url, req, res) {
    try {
        switch (url[0]) {
            case 'availableDates': {
                res.send(await dbStats.getAvailableDates());
                break;
            }
            case 'operationStats': {
                if (req.query.dates === undefined) {
                    res.send(false);
                } else {
                    let data = [];
                    let dates = JSON.parse(req.query.dates);

                    for (const pair of dates) {
                        data.push(await dbStats.getStats('operation_data_stats', pair[0], pair[1]))
                    }

                    res.send(data);
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