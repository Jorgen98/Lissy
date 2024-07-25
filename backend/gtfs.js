/*
 * GTFS data function file
 */

const dotenv = require('dotenv');
const fs = require('fs');
const decompress = require("decompress");
const https = require('https');

const logService = require('./log.js');
const dbPostGIS = require('./db-postgis.js');

const tmpFileName = './gtfs.zip';
const tmpFolderName = './gtfsFiles/'
//const file = fs.createWriteStream(tmpFileName);

let todayServiceIDs = [];
let useAllServices = false;

// .env file include
dotenv.config();

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_PROCESSING_MODULE_NAME, type, msg)
}

// Function for transit system state actualization based on actual GTFS data
async function reloadActualSystemState(stats) {
    if (process.env.BE_PROCESSING_GTFS_LINK === undefined) {
        log('error', 'GTFS file link not defined');
        return false;
    }

    log('info', 'Downloading file from mestobrno.maps.arcgis.com');
    return new Promise(async (resolve) => {

        resolve(await unzipAndParseData());
        return;

        https.get(process.env.BE_PROCESSING_GTFS_LINK, async response => {
            if (!await unzipAndParseData(response)) {
                fs.unlink(tmpFileName, (error) => {
                    if (error) {
                        log('error', error);
                    }
                    resolve(false);
                });
                return;
            }

            fs.unlink(tmpFileName, (error) => {
                if (error) {
                    log('error', error);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        })
        .on('error', error => {
            log('error', error);
            fs.unlink(tmpFileName, (error) => {
                if (error) {
                    log('error', error);
                }
                resolve(false);
            });
        });
    });
}


// Function for downloaded data unzip and parse
async function unzipAndParseData(/*response*/) {
    return new Promise((resolve) => {
        try {
            //response.pipe(file);

            //file.on('finish', () => {
                log('info', 'GTFS file successfully downloaded, parsing content');

                decompress(tmpFileName, tmpFolderName).then(async (inputFiles) => {
                    if (!inputFiles.find((file) => { return file.path === 'routes.txt'}) ||
                        !inputFiles.find((file) => { return file.path === 'stops.txt'}) ||
                        !inputFiles.find((file) => { return file.path === 'stop_times.txt'}) ||
                        !inputFiles.find((file) => { return file.path === 'trips.txt'})) {
                            log('error', 'GTFS file set is incomplete');
                            fs.rmSync(tmpFolderName, { recursive: true });
                            resolve(false);
                            return;
                    }

                    // Process stops data
                    log('info', 'Processing GTFS stops data');
                    if (!await getTodayStops(inputFiles.find((file) => { return file.path === 'stops.txt'}))) {
                        log('error', 'GTFS stops data are corrupted');
                        fs.rmSync(tmpFolderName, { recursive: true });
                        resolve(false);
                        return;
                    }

                    // Process calendar data
                    log('info', 'Processing GTFS calendar data');
                    if (!inputFiles.find((file) => { return file.path === 'calendar.txt'}) ||
                        !inputFiles.find((file) => { return file.path === 'calendar_dates.txt'})) {
                        useAllServices = true;
                    } else {
                        useAllServices = false;
                        if (!getTodayServices(inputFiles.find((file) => { return file.path === 'calendar.txt'}),
                            inputFiles.find((file) => { return file.path === 'calendar_dates.txt'}))) {
                                log('error', 'GTFS calendar data are corrupted');
                                fs.rmSync(tmpFolderName, { recursive: true });
                                resolve(false);
                                return;
                            }
                    }

                    fs.rmSync(tmpFolderName, { recursive: true });
                    resolve(true);
                });
            //})
            //.on('error', (error) => {
            //    log('error', error);
            //    resolve(false);
            //});
        } catch(error) {
            log('error', error);
            resolve(false);
        }
    });
}

async function getTodayStops(inputStopFile) {
    if (inputStopFile?.data === undefined) {
        return false;
    }

    let inputStopData = inputStopFile.data.toString().split('\n');
    const header = inputStopData[0].split(',');
    inputStopData.shift();

    const stopNameIdx = header.findIndex((item) => {return item === 'stop_name'});
    const latIdx = header.findIndex((item) => {return item === 'stop_lat'});
    const lonIdx = header.findIndex((item) => {return item === 'stop_lon'});
    const zoneIdx = header.findIndex((item) => {return item === 'zone_id'});
    const parentStationIdx = header.findIndex((item) => {return item === 'parent_station'});
    const wheelchairBoardingIdx = header.findIndex((item) => {return item === 'wheelchair_boarding'});

    if (stopNameIdx === -1 || latIdx === -1 || lonIdx === -1) {
        return false;
    }

    for (const record of inputStopData) {
        let decRecord = record.split(/","|",|,"|"|(?:(?=,\S)(,))|,\n|,\r/);
        let idx = 0;

        if (decRecord.length < 2) {
            continue;
        }

        if (decRecord[0] === '') {
            decRecord.splice(0, 1);
        }
        while (decRecord.length > idx) {
            if (decRecord[idx] === undefined || decRecord[idx] === ',') {
                decRecord.splice(idx, 1);
            } else {
                idx++;
            }
        }

        let newLatLng = [0, 0];

        try {
            newLatLng = [parseFloat(decRecord[latIdx]), parseFloat(decRecord[lonIdx])];
        } catch (error) {}

        let newStop = {
            stop_name: decRecord[stopNameIdx] ? decRecord[stopNameIdx] : '',
            latLng: newLatLng,
            zone_id: decRecord[zoneIdx] ? decRecord[zoneIdx] : '',
            parent_station: decRecord[parentStationIdx] ? null : null,
            wheelchair_boarding: parseInt(decRecord[wheelchairBoardingIdx]) ? parseInt(decRecord[wheelchairBoardingIdx]) : 0
        }

        console.log(newStop)

        //await dbPostGIS.addStop(newStop)
        await dbPostGIS.getActiveStops();
        return;
    }

    return true;
}

// Function for decoding which services should be operated today
function getTodayServices(inputCalendarFile, inputDatesFile) {
    todayServiceIDs = [];
    let today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;

    if (inputCalendarFile?.data === undefined && inputDatesFile?.data === undefined) {
        return false;
    }

    // Process calendar data if provided
    // https://gtfs.org/schedule/reference/#calendartxt
    if (inputCalendarFile?.data !== undefined) {
        let inputCalendarData = inputCalendarFile.data.toString().split('\n');
        if (inputCalendarData.length > 0) {
            inputCalendarData.shift();

            for (const record of inputCalendarData) {
                const decRecord = record.split(',');

                if (decRecord.length !== 10) {
                    continue;
                }

                let start = parseDateFromGTFS(decRecord[8]);
                let end = parseDateFromGTFS(decRecord[9]);

                if (decRecord[dayOfWeek + 1] === '1' && start <= today && today <= end) {
                    try {
                        todayServiceIDs.push(parseInt(decRecord[0]));
                    } catch (error) {}
                }
            }
        } else {
            return false;
        }
    }

    // Provide calendar dates data if provided
    // https://gtfs.org/schedule/reference/#calendar_datestxt
    if (inputDatesFile?.data !== undefined) {
        let inputDatesData = inputDatesFile.data.toString().split('\n');
        if (inputDatesData.length > 0) {
            inputDatesData.shift();

            for (const record of inputDatesData) {
                let decRecord = record.split(',');

                if (decRecord.length !== 3) {
                    continue;
                }

                decRecord[2] = decRecord[2].slice(0, 1);

                let date = parseDateFromGTFS(decRecord[1]);
                if (decRecord[2] === '1' && date.valueOf() === today.valueOf()) {
                    try {
                        if (!todayServiceIDs.find((itm) => { return itm === parseInt(decRecord[0])})) {
                            todayServiceIDs.push(parseInt(decRecord[0]));
                        }
                    } catch (error) {}
                } else if (decRecord[2] === '2' && date.valueOf() === today.valueOf()) {
                    try {
                        if (todayServiceIDs.find((itm) => { return itm === parseInt(decRecord[0])})) {
                            let idx = todayServiceIDs.findIndex((itm) => { return itm === parseInt(decRecord[0])});
                            todayServiceIDs.splice(idx, 1);
                        }
                    } catch (error) {}
                }
            }
        } else {
            return false;
        }
    }

    return true;
}

// Try to create JS Date format from GTFS input data
function parseDateFromGTFS(input) {
    input = `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}`;

    try {
        return new Date(input);
    } catch(error) {
        return new Date('1970-01-01');
    }
}

module.exports = { reloadActualSystemState }