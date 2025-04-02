/*
 * BE Processing Main File
 */

const express = require('express');
const dotenv = require('dotenv');
const app = express();
const cron = require('node-cron');

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');
const gtfsService = require('./gtfs.js');
const opProcessingService = require('./be-processing-operational-data.js');
const timeStamp = require('./timeStamp.js');

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

// Regular job functions
// Main data processing function
cron.schedule('15 2 * * *', async () => {
    log('info', 'Running scheduled actualization job. Processing real operation data and actualizing transit system');
    if (await processData()) {
        log('success', 'Actualization procedure is done');
    };
});
// Run another attempt of processing function in case of error of the first attempt
cron.schedule('15 3 * * *', async () => {
    log('info', 'Running backup scheduled actualization job. Processing real operation data and actualizing transit system');
    if (await processData()) {
        log('success', 'Actualization procedure is done');
    };
});

// Processing function
async function processData() {
    let today = timeStamp.getTimeStamp(timeStamp.getTodayUTC());
    let lastGTFSRecord = await dbStats.getStats('expected_state', timeStamp.removeOneDayFromTimeStamp(today), today, true);

    // Main processing switch, depends on actual stateDB data, what will be done
    // 1. Process delay data and actualize system state
    // 2. Actualize system state only
    // 3. Do nothing, we need to wait for next day to process data
    if (Object.keys(lastGTFSRecord).length > 0) {
        if (timeStamp.compareTimeStamps(timeStamp.getTimeStamp(Object.keys(lastGTFSRecord)[Object.keys(lastGTFSRecord).length - 1]), today) === -1) {
            log('info', 'Today system state has been actualized, waiting for next day to process data.');
            return true;
        }

        // Are there any trips to process, parse data from real operations?
        let tripsToBeProcessedNum = (await dbPostGIS.getPlannedTrips(await dbPostGIS.getActiveRoutesToProcess())).length;
        if (tripsToBeProcessedNum > 0) {
            // Yes, process this data
            if (! await opProcessingService.processServedTrips()) {
                return false;
            }
        }

        // Are there still trips to process, especially trips which do not end until now?
        tripsToBeProcessedNum = (await dbPostGIS.getPlannedTrips(await dbPostGIS.getActiveRoutesToProcess())).length;
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

    // Load or reload transit net data
    if (await dbPostGIS.reloadNetFiles()) {
        log('success', 'Net files for routing are loaded');
    } else {
        server.close(() => {
            log('error', 'Can not find new or load actual net files from DB, shutting down');
            process.exit(0);
        });
    }

    // Actualization of transit system state
    dbStats.initStateProcessingStats();
    if (!(await gtfsService.reloadActualSystemState())) {
        return false;
    }
    await dbStats.saveStateProcessingStats();

    return true;
}