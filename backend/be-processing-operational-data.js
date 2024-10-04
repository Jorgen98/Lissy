/*
 * BE Processing real operational data
 */

const express = require('express');
const dotenv = require('dotenv');

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_OP_DATA_PROCESSING_MODULE_NAME, type, msg)
}

async function processServedTrips() {
    log('info', 'haha')

    return true;
}

module.exports = { processServedTrips }