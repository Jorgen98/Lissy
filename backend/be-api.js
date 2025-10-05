/*
 * BE API Main File
 */

const express = require('express');
const dotenv = require('dotenv');
const app = express();
const cors = require('cors');

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const dbCache = require('./db-cache.js');
const logService = require('./log.js');
const weather = require('./be-weather.js');

// modules
const modules = [
    require('../frontend/modules/about/api.js'),
    require('../frontend/modules/stats/api.js'),
    require('../frontend/modules/shapes/api.js'),
    require('../frontend/modules/delay-trips/api.js')
];

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_API_MODULE_NAME, type, msg)
}

// CORS setup
app.use(cors());

// Function for API Token verification
async function verifyToken(req, res, next) {
    const token = process.env.BE_API_MODULE_TOKEN;
  
    if (process.env.API_KEY === 'true' && req.headers['authorization'] !== token) {
        log('info', 'Attempt with false API Token verification');
        res.send(false);
        return;
    }

    let url = req.originalUrl.split(/[?\/]/);
    let idx = 0;
    while (idx < url.length) {
        if (url[idx] == '') {
            url.splice(idx, 1);
        } else {
            idx++;
        }
    }

    if (url.length < 1 || url[0] !== 'lissy' || url[1] !== 'api') {
        res.send(false);
    } else if (url.length == 2) {
        try {
            res.send(await dbPostGIS.connectToDB() && await dbStats.isDBConnected());
        } catch (error) {
            log('error', error);
            res.send(false);
        }
    } else if (url[2] === 'weather') {
        weather.handleAPIReq(req, url[3], res);
    } else {
        for (const module of modules) {
            if (module.env.apiPrefix === url[2] && module.env.enabled) {
                module.processRequest(url.slice(3), req, res);
                return;
            }
        }

        res.send(false);
    }
}

// Try to run processing service
let server = app.listen(7001, async () => {
    log('success', 'API service is running');
})

// Try to connect to DB and refresh net files
server.on('listening', async () => {
    if (await dbPostGIS.connectToDB() && await dbStats.isDBConnected() && await dbCache.isDBConnected()) {
        log('success', 'DBs connected');
    } else {
        server.close(() => {
            log('error', 'Can not established DBs connection, shutting down');
            process.exit(0);
        });
    }
})

// API Token activation
app.use(verifyToken);