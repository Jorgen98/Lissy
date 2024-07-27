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
let todayAgencyIds = {};
let todayStopIds = {};
let todayRouteIds = {};

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

                    // Process agencies data
                    log('info', 'Processing GTFS agencies data');
                    if (!await getTodayAgencies(inputFiles.find((file) => { return file.path === 'agency.txt'}))) {
                        log('error', 'GTFS agencies data are corrupted');
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

                    // Process routes data
                    log('info', 'Processing GTFS routes data');
                    if (!await getTodayRoutes(inputFiles.find((file) => { return file.path === 'routes.txt'}))) {
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

// Function for processing agency file
async function getTodayAgencies(inputAgencyFile) {
    if (inputAgencyFile?.data === undefined) {
        return false;
    }

    let inputAgencyData = inputAgencyFile.data.toString().split('\n');
    const header = inputAgencyData[0].split(',');
    inputAgencyData.shift();

    const agencyIdIdx = header.findIndex((item) => {return item.slice(1) === 'agency_id'});
    const agencyNameIdx = header.findIndex((item) => {return item === 'agency_name'});
    const agencyUrlIdx = header.findIndex((item) => {return item === 'agency_url'});
    const agencyTimeZoneIdx = header.findIndex((item) => {return item === 'agency_timezone'});
    const agencyLangIdx = header.findIndex((item) => {return item === 'agency_lang'});
    const agencyPhoneIdx = header.findIndex((item) => {return item === 'agency_phone'});
    const agencyFareIdx = header.findIndex((item) => {return item === 'agency_fare_url'});
    const agencyEmailIdx = header.findIndex((item) => {return item === 'agency_email_url'});

    if ((agencyNameIdx === -1 && agencyUrlIdx === -1) || agencyTimeZoneIdx === -1) {
        return false;
    }

    let actualActiveAgencies = await dbPostGIS.getActiveAgencies();

    // Process input zip data
    // https://gtfs.org/schedule/reference/#agencytxt
    for (const record of inputAgencyData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined) {
            continue;
        }

        let newAgency = {
            id: null,
            agency_id: decRecord[agencyIdIdx] ? decRecord[agencyIdIdx] : '',
            agency_name: decRecord[agencyNameIdx] ? decRecord[agencyNameIdx] : '',
            agency_url: decRecord[agencyUrlIdx] ? decRecord[agencyUrlIdx] : '',
            agency_timezone: decRecord[agencyTimeZoneIdx] ? decRecord[agencyTimeZoneIdx] : '',
            agency_lang: decRecord[agencyLangIdx] ? decRecord[agencyLangIdx] : '',
            agency_phone: decRecord[agencyPhoneIdx] ? decRecord[agencyPhoneIdx] : '',
            agency_fare_url: decRecord[agencyFareIdx] ? decRecord[agencyFareIdx] : '',
            agency_email: decRecord[agencyEmailIdx] ? decRecord[agencyEmailIdx] : '',
        }

        let actualAgency = actualActiveAgencies[newAgency.agency_id];
        newAgency.id = actualAgency?.id;
        if (actualAgency === undefined || JSON.stringify(actualAgency) !== JSON.stringify(newAgency)) {
                if (actualAgency !== undefined) {
                    if (! await dbPostGIS.makeObjUnActive(actualActiveAgencies[newAgency.agency_id].id, 'agency')) {
                        return false;
                    }
                }

                todayAgencyIds[newAgency.agency_id] = await dbPostGIS.addAgency(newAgency);
    
                if (todayAgencyIds[newAgency.agency_id] === null) {
                    return false;
                }
        } else {
            todayAgencyIds[newAgency.agency_id] = actualAgency.id;
        }
    }

    return true;
}

// Function for processing stops file
async function getTodayStops(inputStopFile) {
    if (inputStopFile?.data === undefined) {
        return false;
    }

    let inputStopData = inputStopFile.data.toString().split('\n');
    const header = inputStopData[0].split(',');
    inputStopData.shift();

    // TO DO: Fill props

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

    // TO DO: id comparison

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
async function getTodayRoutes(inputRoutesFile) {
    if (inputRoutesFile?.data === undefined) {
        return false;
    }

    // TO DO: props, comparison, agency_id

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

    let actualActiveRoutes = await dbPostGIS.getActiveRoutes();

    // Process input zip data
    // https://gtfs.org/schedule/reference/#routestxt
    for (const record of inputRoutesData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined) {
            continue;
        }

        let newRoute = {
            route_id: decRecord[routeIdIdx] ? decRecord[routeIdIdx] : '',
            agency_id: decRecord[agencyIdIdx] ? decRecord[agencyIdIdx] : '',
            route_short_name: decRecord[routeShortNameIdx] ? decRecord[routeShortNameIdx] : '',
            route_long_name: decRecord[routeLongNameIdx] ? decRecord[routeLongNameIdx] : '',
            route_type: decRecord[routeTypeIdx] ? parseInt(decRecord[routeTypeIdx]) : -1,
            route_color: decRecord[routeColorIdx] ? decRecord[routeColorIdx] : 'FFFFFF',
            route_text_color: decRecord[routeTextColorIdx] ? decRecord[routeTextColorIdx] : '000000',
            day_time: null
        }

        if (process.env.BE_PROCESSING_ROUTES_DAY !== undefined && process.env.BE_PROCESSING_ROUTES_DAY !== '') {
            if (decRecord[routeIdIdx].match(process.env.BE_PROCESSING_ROUTES_DAY)) {
                newRoute.day_time = 0;
            }
        }
        if (process.env.BE_PROCESSING_ROUTES_NIGHT !== undefined && process.env.BE_PROCESSING_ROUTES_NIGHT !== '') {
            if (decRecord[routeIdIdx].match(process.env.BE_PROCESSING_ROUTES_NIGHT)) {
                newRoute.day_time = 1;
            }
        }
        if (process.env.BE_PROCESSING_ROUTES_DAY === undefined && process.env.BE_PROCESSING_ROUTES_NIGHT === undefined) {
            newRoute.day_time = 0;
        }

        if (newRoute.day_time === null) {
            continue;
        }

        let actualRoute = actualActiveRoutes[newRoute.route_id];
        if (actualRoute === undefined ||
            actualRoute.route_id !== newRoute.route_id ||
            actualRoute.agency_id !== newRoute.agency_id ||
            actualRoute.route_short_name !== newRoute.route_short_name ||
            actualRoute.route_long_name !== newRoute.route_long_name ||
            actualRoute.route_type !== newRoute.route_type ||
            actualRoute.route_color !== newRoute.route_color ||
            actualRoute.route_text_color !== newRoute.route_text_color ||
            actualRoute.day_time !== newRoute.day_time) {
                if (actualRoute !== undefined) {
                    if (! await dbPostGIS.makeObjUnActive(actualActiveRoutes[newRoute.route_id].id, 'routes')) {
                        return false;
                    }
                }
    
                todayRouteIds[newRoute.route_id] = await dbPostGIS.addRoute(newRoute);
    
                if (todayRouteIds[newRoute.route_id] === null) {
                    return false;
                }
        } else {
            todayRouteIds[newRoute.route_id] = actualRoute.id;
        }
    }

    return true;
}

// Function for processing routes file
async function getTodayTrips(inputRoutesFile) {
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

    // Process input zip data
    // https://gtfs.org/schedule/reference/#stop_timestxt
    for (const record of inputRoutesData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined) {
            continue;
        }

        let newRoute = {
            route_id: decRecord[routeIdIdx] ? decRecord[routeIdIdx] : '',
            agency_id: decRecord[agencyIdIdx] ? decRecord[agencyIdIdx] : '',
            route_short_name: decRecord[routeShortNameIdx] ? decRecord[routeShortNameIdx] : '',
            route_long_name: decRecord[routeLongNameIdx] ? decRecord[routeLongNameIdx] : '',
            route_type: decRecord[routeTypeIdx] ? parseInt(decRecord[routeTypeIdx]) : -1,
            route_color: decRecord[routeColorIdx] ? decRecord[routeColorIdx] : 'FFFFFF',
            route_text_color: decRecord[routeTextColorIdx] ? decRecord[routeTextColorIdx] : '000000',
            day_time: null
        }

        console.log(decRecord)

        // TO DO
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