/*
 * API functions file
 */

const logService = require('../../../backend/log.js');
const dbPostGIS = require('../../../backend/db-postgis.js');
const dbStats = require('../../../backend/db-stats.js');

const env = require('./config.json');

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.FE_MODULE_NAME, type, msg)
}

async function processRequest(url, req, res) {
    try {
        res.send({'a': 'aaa'});
    } catch (error) {
        log('error', error);
        res.send(false);
    }
}

module.exports = { processRequest, env }