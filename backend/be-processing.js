/*
 * BE Processing Main File
 */

const express = require('express');
const dotenv = require('dotenv');
const app = express();

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.DB_PROCESSING_MODULE_NAME, type, msg)
}

// Try to run processing service
let server = app.listen(null, async () => {
    log('success', 'Processing service is running');
})

server.on('listening', async () => {
    if (await dbPostGIS.connectToDB() && await dbStats.isDBConnected()) {
        log('success', 'DBs connected');
    } else {
        server.close(() => {
            log('info', 'Can not established DBs connection, shutting down');
            process.exit(0);
        });
    }
})