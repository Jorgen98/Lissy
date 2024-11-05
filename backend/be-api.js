/*
 * BE API Main File
 */

const express = require('express');
const dotenv = require('dotenv');
const app = express();
const cors = require('cors');

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_API_MODULE_NAME, type, msg)
}

// Base API URL
const apiBaseUrl = '/lissy/api/';

// CORS setup
app.use(cors());

// Function for API Token verification
function verifyToken(req, res, next) {
    const token = process.env.BE_API_MODULE_TOKEN;
  
    if (process.env.API_KEY === 'true' && req.headers['authorization'] !== token) {
      log('info', 'Attempt with false API Token verification');
      res.send(false);
      return;
    }
  
    next();
}

// API Token activation
app.use(verifyToken);

// Try to run processing service
let server = app.listen(7001, async () => {
    log('success', 'API service is running');
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
})

// Default API endpoint to connection check
app.get(apiBaseUrl, async (req, res) => {
    try {
        res.send(await dbPostGIS.connectToDB() && await dbStats.isDBConnected());
    } catch (error) {
        log('error', error);
        res.send(false);
    }
});