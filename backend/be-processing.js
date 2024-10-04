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
const opProcessingService = require('./be-processing-operational-data.js');

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
    let lastGTFSRecord = await dbStats.getStats('expected_state', (new Date()).valueOf() - (1000 * 3600 * 24), new Date(), true);

    // Main processing switch, depends on actual stateDB data, what will be done
    // 1. Process delay data and actualize system state
    // 2. Actualize system state only
    // 3. Do nothing, we need to wait for next day to process data
    if (Object.keys(lastGTFSRecord).length == 1) {
        let recordTimeStamp = new Date(Object.keys(lastGTFSRecord)[0]);

        recordTimeStamp.setHours(0, 0, 0, 0);
        let timeDiff = ((new Date()).setHours(0, 0, 0, 0).valueOf() - recordTimeStamp.valueOf())
        if (timeDiff === 0) {
            log('info', 'Today system state has been actualized, waiting for next day to process data.');
            //return true;
        }

        // Are there any trips to process, parse data from real operations?
        let tripsToBeProcessedNum = Object.keys(await dbPostGIS.getPlannedTrips(await dbPostGIS.getActiveRoutes())).length;
        if (tripsToBeProcessedNum > 0) {
            // Yes, process this data
            if (! await opProcessingService.processServedTrips()) {
                return false;
            }
        }

        // Are there still trips to process, especially trips which do not end until now?
        tripsToBeProcessedNum = Object.keys(await dbPostGIS.getPlannedTrips(await dbPostGIS.getActiveRoutes())).length;
        if (tripsToBeProcessedNum > 0) {
            // Yes, we need to run processing one more time later
            log('info', 'There are still trips to process, but this trips not finished yet. Please run processing one more time later.');
            return true;
        }

        // No, we processed all trips, so we can actualize transit system structure and wait until next processing time
        log('info', 'Starting system state actualization.');
    } else {
        log('info', 'There is no actual system state. Starting actualization.');
    }

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