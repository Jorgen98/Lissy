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
let todayStopIds = {};
let todayLineIds = {};

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

                    // Process lines data
                    log('info', 'Processing GTFS lines data');
                    if (!await getTodayLines(inputFiles.find((file) => { return file.path === 'routes.txt'}))) {
                        log('error', 'GTFS routes data are corrupted');
                        fs.rmSync(tmpFolderName, { recursive: true });
                        resolve(false);
                        return;
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

    const stopIdIdx = 0;
    const stopNameIdx = header.findIndex((item) => {return item === 'stop_name'});
    const latIdx = header.findIndex((item) => {return item === 'stop_lat'});
    const lonIdx = header.findIndex((item) => {return item === 'stop_lon'});
    const zoneIdx = header.findIndex((item) => {return item === 'zone_id'});
    const parentStationIdx = header.findIndex((item) => {return item === 'parent_station'});
    const wheelchairBoardingIdx = header.findIndex((item) => {return item === 'wheelchair_boarding'});

    if (stopNameIdx === -1 || latIdx === -1 || lonIdx === -1) {
        return false;
    }

    let inputStopsHierarchy = {};
    let inputStopsToPlace = [];

    // Process input zip data
    // https://gtfs.org/schedule/reference/#stopstxt
    for (const record of inputStopData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined) {
            continue;
        }

        let newLatLng = [0, 0];

        try {
            newLatLng = [parseFloat(decRecord[latIdx]), parseFloat(decRecord[lonIdx])];
        } catch (error) {}

        let newStop = {
            stop_id: decRecord[stopIdIdx] ? decRecord[stopIdIdx] : '',
            stop_name: decRecord[stopNameIdx] ? decRecord[stopNameIdx] : '',
            latLng: newLatLng,
            zone_id: decRecord[zoneIdx] ? decRecord[zoneIdx] : '',
            parent_station: decRecord[parentStationIdx] ? decRecord[parentStationIdx] : '',
            parent_station_id: null,
            wheelchair_boarding: parseInt(decRecord[wheelchairBoardingIdx]) ? parseInt(decRecord[wheelchairBoardingIdx]) : 0,
            child_stops: []
        }

        if (inputStopsHierarchy[newStop.stop_id] === undefined && newStop.parent_station === '') {
            inputStopsHierarchy[newStop.stop_id] = newStop;
        } else if (inputStopsHierarchy[newStop.stop_id] === undefined) {
            inputStopsToPlace.push(newStop);
        }
    }

    // Create stops hierarchy based on parent_station prop
    let idx = 0;
    while (inputStopsToPlace.length > 0) {
        idx = 0;
        while (inputStopsToPlace.length > idx && inputStopsToPlace.length > 0) {
            if (inputStopsToPlace.find((stop) => {return stop.parent_station === inputStopsToPlace[idx].stop_id})) {
                idx++;
            } else {
                if (inputStopsHierarchy[inputStopsToPlace[idx].parent_station] !== undefined) {
                    inputStopsHierarchy[inputStopsToPlace[idx].parent_station].child_stops.push(JSON.parse(JSON.stringify(inputStopsToPlace[idx])));
                } else {
                    let newIdx = inputStopsToPlace.findIndex((stop) => {return stop.stop_id === inputStopsToPlace[idx].parent_station});
                    inputStopsToPlace[newIdx].child_stops.push(JSON.parse(JSON.stringify(inputStopsToPlace[idx])));
                }
                inputStopsToPlace.splice(idx, 1);
            }
        }
    }

    todayStopIds = await dbPostGIS.getActiveStops();

    for (const stop_id in inputStopsHierarchy) {
        if (!await inspectProcessedStop(inputStopsHierarchy[stop_id])) {
            return false;
        }
    }

    return true;
}

// Help function for inspect, if the stop need to be replaced by new version
async function inspectProcessedStop(stop, replace = false) {
    let actualStop = todayStopIds[stop.stop_id];
    let replaceChild = false;

    if (actualStop === undefined ||
        actualStop.stop_id !== stop.stop_id ||
        actualStop.stop_name !== stop.stop_name ||
        actualStop.latLng[0] !== stop.latLng[0] ||
        actualStop.latLng[1] !== stop.latLng[1] ||
        actualStop.zone_id !== stop.zone_id ||
        actualStop.parent_station !== stop.parent_station ||
        actualStop.wheelchair_boarding !== stop.wheelchair_boarding ||
        replace) {
            if (stop.parent_station !== '') {
                stop.parent_station_id = todayStopIds[stop.parent_station];
            }

            if (actualStop !== undefined) {
                if (! await dbPostGIS.makeObjUnActive(todayStopIds[stop.stop_id].id, 'stops')) {
                    return false;
                }
            }

            todayStopIds[stop.stop_id] = await dbPostGIS.addStop(stop);
            replaceChild = true;

            if (todayStopIds[stop.stop_id] === null) {
                return false;
            }
    } else {
        todayStopIds[stop.stop_id] = todayStopIds[stop.stop_id].id;
    }

    for (const childStop of stop.child_stops) {
        if (!await inspectProcessedStop(childStop, replaceChild)) {
            return false;
        }
    }

    return true;
}

// Function for processing routes file
async function getTodayLines(inputRoutesFile) {
    if (inputRoutesFile?.data === undefined) {
        return false;
    }

    let inputRoutesData = inputRoutesFile.data.toString().split('\n');
    const header = inputRoutesData[0].split(',');
    inputRoutesData.shift();

    const routeIdIdx = 0;
    const agencyIdIdx = header.findIndex((item) => {return item === 'agency_id'});
    const routeShortNameIdx = header.findIndex((item) => {return item === 'route_short_name'});
    const routeLongNameIdx = header.findIndex((item) => {return item === 'route_long_name'});
    const routeTypeIdx = header.findIndex((item) => {return item === 'route_type'});
    const routeColorIdx = header.findIndex((item) => {return item === 'route_color'});
    const routeTextColorIdx = header.findIndex((item) => {return item === 'route_text_color'});

    if ((routeLongNameIdx === -1 && routeShortNameIdx === -1) || routeTypeIdx === -1) {
        return false;
    }

    let actualActiveLines = await dbPostGIS.getActiveLines();

    // Process input zip data
    // https://gtfs.org/schedule/reference/#routestxt
    for (const record of inputRoutesData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined) {
            continue;
        }

        let newLine = {
            route_id: decRecord[routeIdIdx] ? decRecord[routeIdIdx] : '',
            agency_id: decRecord[agencyIdIdx] ? decRecord[agencyIdIdx] : '',
            route_short_name: decRecord[routeShortNameIdx] ? decRecord[routeShortNameIdx] : '',
            route_long_name: decRecord[routeLongNameIdx] ? decRecord[routeLongNameIdx] : '',
            route_type: decRecord[routeTypeIdx] ? parseInt(decRecord[routeTypeIdx]) : -1,
            route_color: decRecord[routeColorIdx] ? decRecord[routeColorIdx] : 'FFFFFF',
            route_text_color: decRecord[routeTextColorIdx] ? decRecord[routeTextColorIdx] : '000000',
            day_time: null
        }

        if (process.env.BE_PROCESSING_LINES_DAY !== undefined && process.env.BE_PROCESSING_LINES_DAY !== '') {
            if (decRecord[routeIdIdx].match(process.env.BE_PROCESSING_LINES_DAY)) {
                newLine.day_time = 0;
            }
        }
        if (process.env.BE_PROCESSING_LINES_NIGHT !== undefined && process.env.BE_PROCESSING_LINES_NIGHT !== '') {
            if (decRecord[routeIdIdx].match(process.env.BE_PROCESSING_LINES_NIGHT)) {
                newLine.day_time = 1;
            }
        }
        if (process.env.BE_PROCESSING_LINES_DAY === undefined && process.env.BE_PROCESSING_LINES_NIGHT === undefined) {
            newLine.day_time = 0;
        }

        if (newLine.day_time === null) {
            continue;
        }

        let actualLine = actualActiveLines[newLine.route_id];
        if (actualLine === undefined ||
            actualLine.route_id !== newLine.route_id ||
            actualLine.agency_id !== newLine.agency_id ||
            actualLine.route_short_name !== newLine.route_short_name ||
            actualLine.route_long_name !== newLine.route_long_name ||
            actualLine.route_type !== newLine.route_type ||
            actualLine.route_color !== newLine.route_color ||
            actualLine.route_text_color !== newLine.route_text_color ||
            actualLine.day_time !== newLine.day_time) {
                if (actualLine !== undefined) {
                    if (! await dbPostGIS.makeObjUnActive(actualActiveLines[newLine.route_id].id, 'lines')) {
                        return false;
                    }
                }
    
                todayLineIds[newLine.route_id] = await dbPostGIS.addLine(newLine);
    
                if (todayLineIds[newLine.route_id] === null) {
                    return false;
                }
        } else {
            todayLineIds[newLine.route_id] = actualLine.id;
        }
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

function parseOneLineFromInputFile(input) {
    let decRecord = input.split(/(?=[","|",|,"|"|\r])|(?<=[","|",|,"|"|\r])/g);
    let idx = 0;
    
    if (decRecord.length < 2) {
        return undefined;
    }

    while (decRecord.length > idx) {
        if (decRecord[idx] === undefined) {
            decRecord.splice(idx, 1);
        } else if (decRecord[idx] === ',' && decRecord[idx + 1] === ',') {
            decRecord.splice(idx + 1, 1);
            decRecord[idx] = "";
            idx++;
        } else if (decRecord[idx] === ',') {
            decRecord.splice(idx, 1);
        } else {
            if (decRecord[idx] === '"') {
                decRecord[idx] = "";
                while (decRecord.length > (idx + 1) && decRecord[idx + 1] !== '"') {
                    decRecord[idx] += decRecord[idx + 1];
                    decRecord.splice(idx + 1, 1);
                }
                decRecord.splice(idx + 1, 1);
            } else if (decRecord[idx] === '\r') {
                decRecord[idx] = "";
            }
            idx++;
        }
    }

    return decRecord;
}

module.exports = { reloadActualSystemState }