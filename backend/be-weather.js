/*
 * BE Weather handling
 */

const https = require('https');
const dotenv = require('dotenv');
const fs = require('fs');

const dbPostGIS = require('./db-postgis.js');
const dbStats = require('./db-stats.js');
const logService = require('./log.js');
const routingService = require('./routing.js');
const timeStamp = require('./timeStamp.js');

let tripsToProcess = {};
let activeShapes = {};
let numOfTripsToProcess = 0;
let progress = 0;
let lastProgressValue = 0;

let now = timeStamp.getTodayUTC();
let yesterdayMidNight = timeStamp.getDateFromTimeStamp(timeStamp.removeOneDayFromTimeStamp(timeStamp.getTimeStamp(now.setUTCHours(0, 0, 0, 0))));
let lastTripEnd = timeStamp.getDateFromTimeStamp(timeStamp.getTimeStamp(yesterdayMidNight));

const saveTestOutput = process.env.TEST_OUTPUTS === 'true' ? true : false;

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_OP_DATA_PROCESSING_MODULE_NAME, type, msg)
}

async function getCurrentData() {
    const positions = JSON.parse(process.env.BE_OP_DATA_PROCESSING_WEATHER_POSITIONS);
    for (const [idx, position] of positions.entries()) {
        const inputData = await downloadData(position[0], position[1], 0);

        if (Object.keys(inputData).length > 0) {
            await dbStats.saveWeatherData(inputData, `position_${idx}`);
        }
    }
}

// Function for downloading data from open weather API
async function downloadData(lat, long, attempt) {
    // https://openweathermap.org/current

    return new Promise(async (resolve) => {
        https.get({
            hostname: "api.openweathermap.org",
            path: `/data/2.5/weather?lat=${lat}&lon=${long}&appid=${process.env.BE_OP_DATA_PROCESSING_WEATHER_TOKEN}`
        }, async res => {
            let { statusCode } = res;
            let contentType = res.headers['content-type'];

            if (statusCode !== 200) {
                log('error', 'Wrong response status code');
                resolve({});
                return;
            } else if (!/^application\/json/.test(contentType)) {
                log('error', 'Invalid response content type');
                resolve({});
                return;
            }

            res.setEncoding('utf8');
            let rawData = '';

            res.on('data', (chunk) => {
                rawData += chunk;
            });

            res.on('end', async () => {
                try {
                    const parsedData = JSON.parse(rawData);
                    if (parsedData === undefined || parsedData.length < 1) {
                        resolve({});
                    } else {
                        resolve(parsedData);
                    }
                } catch (e) {
                    resolve({});
                }
            });
        })
        .on('error', async error => {
            log('error', error);
            if (attempt < 5) {
                resolve(await downloadData(lat, long, attempt + 1));
            } else {
                resolve({});
            }
        });
    });
}

// Handle API calls on data
async function handleAPIReq(req, url, res) {
    try {
        if (url === 'data') {
            const start = parseInt(req.query.from);
            const stop = parseInt(req.query.to);

            let positionId = null;
            if (req.query.positionId) {
                positionId = parseInt(req.query.positionId);
            }

            res.send(await dbStats.getWeatherDataInInterval(positionId, start, stop));
        } else if (url === 'positions') {
            const positions = JSON.parse(process.env.BE_OP_DATA_PROCESSING_WEATHER_POSITIONS);
            const result = {};
            for (const [idx, position] of positions.entries()) {
                result[idx] = position;
            }

            res.send(result);
        } else {
            res.send(false);
        }
    } catch (error) {
        log('error', error);
        res.send(false);
    }
}

module.exports = { getCurrentData, handleAPIReq }