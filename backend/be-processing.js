/*
 * BE Processing Main File
 */

const express = require('express');
const dotenv = require('dotenv');
const app = express();

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');

// .env file include
dotenv.config();

// Try to run processing BE
app.listen(null, async () => {
    console.log(await dbPostGIS.isDBConnected());
    console.log(await dbStats.isDBConnected());

    console.log('a')
})