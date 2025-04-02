/*
 * DB Cache function file
 */

const dotenv = require('dotenv');
const redis = require('redis');

const logService = require('./log.js');
const timeStamp = require('./timeStamp.js');

// .env file include
dotenv.config();

// Cache DB instant
const db_redis = redis.createClient({
    url: `redis://:${process.env.DB_CACHE_TOKEN}@${process.env.DB_CACHE_HOST}:6379`
});

// Cache DB error handle function
db_redis.on('error', err => log('error', err));

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.DB_CACHE_MODULE_NAME, type, msg)
}

// Help function for DB connection test
async function isDBConnected() {
    try {
        await db_redis.connect();
        await db_redis.set('test', 'test');
        await db_redis.del('test');
        return true;
    } catch(error) {
        log('error', error);
        return false;
    }
}

// Main value processing function, it creates new key, return progress or store data according to input params
async function setUpValue(key, data, progress) {
    let actualValue = JSON.parse(await db_redis.get(key));

    // Key already exists in cache DB
    if (actualValue !== null) {
        // After defined time, if there will be none request, data will be deleted from cache DB
        await db_redis.expireAt(key, parseInt((timeStamp.getTodayUTC().getTime()) / 1000) + 60 * 60 * parseInt(process.env.DB_CACHE_DURABILITY));

        // Store data from finished operation
        if (data !== null) {
            try {
                await db_redis.set(key, JSON.stringify({progress: 100, data: data}));
                return true;
            } catch(error) {
                log('error', error);
                return false;
            }
        } else {
            // Update progress
            if (progress !== null) {
                try {
                    await db_redis.set(key, JSON.stringify({progress: progress, data: null}));
                    return true;
                } catch(error) {
                    log('error', error);
                    return false;
                }
            }
            // Get data, if exists, or get progress
            return {progress: actualValue.progress, data: actualValue.data};
        }
    // Key is not in cache DB yet
    } else {
        try {
            await db_redis.set(key, JSON.stringify({progress: 0, data: null}));
            return { progress: 0, data: null };
        } catch(error) {
            log('error', error);
            return false;
        }
    }
}

module.exports = { isDBConnected, setUpValue }