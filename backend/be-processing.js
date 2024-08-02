/*
 * BE Processing Main File
 */

const express = require('express');
const dotenv = require('dotenv');
const app = express();

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');
const gtfsService = require('./gtfs.js');

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_PROCESSING_MODULE_NAME, type, msg)
}

// Try to run processing service
let server = app.listen(null, async () => {
    log('success', 'Processing service is running');
})

// Try to connect to DB and refresh net files
server.on('listening', async () => {
    if (await dbPostGIS.connectToDB() && await dbStats.isDBConnected()) {
        log('success', 'DBs connected');
    } else {
        server.close(() => {
            log('error', 'Can not established DBs connection, shutting down');
            process.exit(0);
        });
    }

    if (await processData()) {
        log('success', 'Initialization procedure is done');
    }
})
const fs = require('fs');
// Processing function
async function processData() {
    // TO DO: Check if the gtfs can be processed

    dbStats.initStateProcessingStats();
    // Load or reload transit net data
    if (await dbPostGIS.reloadNetFiles()) {
        log('success', 'Net files for routing are loaded');
    } else {
        server.close(() => {
            log('error', 'Can not find new or load actual net files from DB, shutting down');
            process.exit(0);
        });
    }

    if (!(await gtfsService.reloadActualSystemState())) {
        return false;
    }

    // Testing function for routing, will be deleted
    fs.writeFile(`backups/${(new Date()).toLocaleString()}.txt`, JSON.stringify(await dbPostGIS.getShapes()), function(err) {
        if (err) {
            console.log(err);
        }
    });
    // Testing function for routing, will be deleted
    fs.writeFile(`backups/${(new Date()).toLocaleString()}_stats.txt`, JSON.stringify(await dbStats.saveStateProcessingStats(), null, 4), function(err) {
        if (err) {
            console.log(err);
        }
    });
    return true;
}