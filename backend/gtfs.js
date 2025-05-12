/*
 * GTFS data function file
 */

const dotenv = require('dotenv');
const fs = require('fs');
const decompress = require("decompress");
const https = require('https');
const { performance } = require('perf_hooks');

const logService = require('./log.js');
const dbPostGIS = require('./db-postgis.js');
const routingService = require('./routing.js');
const dbStats = require('./db-stats.js');
const timeStamp = require('./timeStamp.js');

const tmpFileName = './gtfs.zip';
const tmpFolderName = './gtfsFiles/'
let file = fs.WriteStream;

let todayServiceIDs = [];
let useAllServices = false;
let todayAgencyIds = {};
let todayStopIds = {};
let todayRouteIds = {};
let shapesToCalc = {};

let todayStopIdsDict = {};

// .env file include
dotenv.config();

const saveTestOutput = process.env.TEST_OUTPUTS === 'true' ? true : false;

// Help function for log writing
function log(type, msg) {
    logService.write(process.env.BE_PROCESSING_MODULE_NAME, type, msg)
}

// Function for transit system state actualization based on actual GTFS data
async function reloadActualSystemState() {
    let startTime = performance.now();
    if (process.env.BE_PROCESSING_GTFS_LINK === undefined) {
        log('error', 'GTFS file link not defined');
        return false;
    }

    log('info', 'Downloading file from mestobrno.maps.arcgis.com');
    file = fs.createWriteStream(tmpFileName);

    return new Promise(async (resolve) => {
        https.get(process.env.BE_PROCESSING_GTFS_LINK, async response => {
            dbStats.updateStateProcessingStats('gtfs_file_downloaded', true);
            if (!await unzipAndParseData(response, startTime)) {
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
async function unzipAndParseData(response, startTime) {
    return new Promise((resolve) => {
        try {
            response.pipe(file);

            file.on('finish', () => {
                log('info', 'GTFS file successfully downloaded, parsing content');

                decompress(tmpFileName, tmpFolderName).then(async (inputFiles) => {
                    if (!inputFiles.find((file) => { return file.path === 'routes.txt'}) ||
                        !inputFiles.find((file) => { return file.path === 'stops.txt'}) ||
                        !inputFiles.find((file) => { return file.path === 'stop_times.txt'}) ||
                        !inputFiles.find((file) => { return file.path === 'trips.txt'})) {
                            log('error', 'GTFS file set is incomplete');
                            dbStats.updateStateProcessingStats('gtfs_file_downloaded', false);
                            try {
                                fs.rmSync(tmpFolderName, { recursive: true });
                            } catch (error) {
                                log('error', error);
                            }
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

                    // Process stop_times & trips data
                    // Process also api data, specific for Brno transit system
                    log('info', 'Processing GTFS trips & stop_times data');
                    if (!await getTodayTrips(inputFiles.find((file) => { return file.path === 'stop_times.txt'}),
                        inputFiles.find((file) => { return file.path === 'api.txt'}),
                        inputFiles.find((file) => { return file.path === 'trips.txt'}))) {
                        log('error', 'GTFS trips & stop_times data are corrupted');
                        fs.rmSync(tmpFolderName, { recursive: true });
                        resolve(false);
                        return;
                    }

                    fs.rmSync(tmpFolderName, { recursive: true });
                    log('success', 'Processing GTFS data done');
                    dbStats.updateStateProcessingStats('gtfs_processing_time', performance.now() - startTime);

                    // If there are new shapes, calculate them
                    if (Object.keys(shapesToCalc).length > 0) {
                        log('info', 'Routing new trip shapes');
                        if (!await getNewShapes()) {
                            log('error', 'Routing trip shapes has failed');
                            fs.rmSync(tmpFolderName, { recursive: true });
                            resolve(false);
                            return;
                        }
                        log('success', 'Shapes routing done');

                        if (saveTestOutput) {
                            fs.writeFile(`backups/${(new Date()).toISOString()}_shapes.txt`, JSON.stringify(await dbPostGIS.getShapes()), function(error) {
                                if (error) {
                                    log('error', error);
                                }
                            });
                        }
                    }
                    dbStats.updateStateProcessingStats('gtfs_shapes', await dbPostGIS.countShapes());

                    resolve(true);
                });
            })
            .on('error', (error) => {
                log('error', error);
                resolve(false);
            });
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
    const header = inputAgencyData[0].slice(1, inputAgencyData[0].length - 1).split(',');
    inputAgencyData.shift();

    const agencyIdIdx = header.findIndex((item) => {return item === 'agency_id'});
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

                dbStats.updateStateProcessingStats('gtfs_agencies_added', 1);
        } else {
            todayAgencyIds[newAgency.agency_id] = actualAgency.id;
        }
    }

    dbStats.updateStateProcessingStats('gtfs_agencies', Object.keys(todayAgencyIds).length);
    return true;
}

// Function for processing stops file
async function getTodayStops(inputStopFile) {
    if (inputStopFile?.data === undefined) {
        return false;
    }

    let inputStopData = inputStopFile.data.toString().split('\n');
    const header = inputStopData[0].slice(1, inputStopData[0].length - 1).split(',');
    inputStopData.shift();

    const stopIdIdx = header.findIndex((item) => {return item === 'stop_id'});
    const stopCodeIdx = header.findIndex((item) => {return item === 'stop_code'});
    const stopNameIdx = header.findIndex((item) => {return item === 'stop_name'});
    const ttsStopNameIdx = header.findIndex((item) => {return item === 'tts_stop_name'});
    const stopDescIdx = header.findIndex((item) => {return item === 'stop_desc'});
    const latIdx = header.findIndex((item) => {return item === 'stop_lat'});
    const lonIdx = header.findIndex((item) => {return item === 'stop_lon'});
    const zoneIdx = header.findIndex((item) => {return item === 'zone_id'});
    const stopUrlIdx = header.findIndex((item) => {return item === 'stop_url'});
    const locationTypeIdx = header.findIndex((item) => {return item === 'location_type'});
    const parentStationIdx = header.findIndex((item) => {return item === 'parent_station'});
    const stopTimeZoneIdx = header.findIndex((item) => {return item === 'stop_timezone'});
    const wheelchairBoardingIdx = header.findIndex((item) => {return item === 'wheelchair_boarding'});
    const levelIdIdx = header.findIndex((item) => {return item === 'level_id'});
    const platformCodeIdx = header.findIndex((item) => {return item === 'platform_code'});

    if (stopIdIdx === -1) {
        return false;
    }

    let inputStopsHierarchy = {};
    let inputStopsToPlace = [];
    todayStopIdsDict = {};

    todayStopIds = await dbPostGIS.getActiveStops();

    // Process input zip data
    // https://gtfs.org/schedule/reference/#stopstxt
    for (const record of inputStopData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined || decRecord[stopIdIdx] === undefined || decRecord[stopIdIdx] === '') {
            continue;
        }

        let newLatLng = [0, 0];

        try {
            newLatLng = [parseFloat(decRecord[latIdx]), parseFloat(decRecord[lonIdx])];
        } catch (error) {
            continue;
        }

        let newStop = {
            id: null,
            stop_id: decRecord[stopIdIdx] ? decRecord[stopIdIdx] : '',
            stop_code: decRecord[stopCodeIdx] ? decRecord[stopCodeIdx] : '',
            stop_name: decRecord[stopNameIdx] ? decRecord[stopNameIdx] : '',
            tts_stop_name: decRecord[ttsStopNameIdx] ? decRecord[ttsStopNameIdx] : '',
            stop_desc: decRecord[stopDescIdx] ? decRecord[stopDescIdx] : '',
            zone_id: decRecord[zoneIdx] ? decRecord[zoneIdx] : '',
            stop_url: decRecord[stopUrlIdx] ? decRecord[stopUrlIdx] : '',
            location_type: parseInt(decRecord[locationTypeIdx]) ? parseInt(decRecord[locationTypeIdx]) : 0,
            parent_station: decRecord[parentStationIdx] ? decRecord[parentStationIdx] : '',
            parent_station_id: null,
            stop_timezone: decRecord[stopTimeZoneIdx] ? decRecord[stopTimeZoneIdx] : '',
            wheelchair_boarding: parseInt(decRecord[wheelchairBoardingIdx]) ? parseInt(decRecord[wheelchairBoardingIdx]) : 0,
            level_id: decRecord[levelIdIdx] ? decRecord[levelIdIdx] : '',
            level_id_id: null,
            platform_code: decRecord[platformCodeIdx] ? decRecord[platformCodeIdx] : '',
            latLng: newLatLng,
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

    for (const stop_id in inputStopsHierarchy) {
        if (!await inspectProcessedStop(inputStopsHierarchy[stop_id], false, 0)) {
            return false;
        }
    }

    dbStats.updateStateProcessingStats('gtfs_stops', Object.keys(todayStopIds).length);
    return true;
}

// Help function for inspect, if the stop need to be replaced by new version
async function inspectProcessedStop(stop, replace = false, level) {
    let stateStopId = JSON.parse(JSON.stringify(stop.stop_id));
    stop.stop_id = `${level}:${stop.stop_name}:${stop.latLng[0].toString()}:${stop.latLng[1].toString()}`;
    let actualStop = todayStopIds[stop.stop_id];
    let replaceChild = false;
    stop.id = actualStop?.id;

    stop.parent_station_id = actualStop?.parent_station_id ? actualStop.parent_station_id : null;
    let actualStopToCmp = actualStop ? JSON.parse(JSON.stringify(actualStop)) : undefined;
    let stopToCmp = JSON.parse(JSON.stringify(stop));
    delete stopToCmp['child_stops'];
    delete stopToCmp['parent_station'];

    if (actualStopToCmp !== undefined) {
        delete actualStopToCmp['parent_station'];
    }

    if (stop.parent_station !== '') {
        stop.parent_station_id = todayStopIds[todayStopIdsDict[stop.parent_station]];
    }

    if (actualStop === undefined || JSON.stringify(actualStopToCmp) !== JSON.stringify(stopToCmp) || replace) {
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
        dbStats.updateStateProcessingStats('gtfs_stops_added', 1);
    } else {
        todayStopIds[stop.stop_id] = todayStopIds[stop.stop_id].id;
    }

    todayStopIdsDict[stateStopId] = stop.stop_id;

    stop.child_stops = stopsSort(stop.child_stops);
    for (const [idx, childStop] of stop.child_stops.entries()) {
        if (!await inspectProcessedStop(childStop, replaceChild, `${level + 1}:${idx}`)) {
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

    let inputRoutesData = inputRoutesFile.data.toString().split('\n');
    const header = inputRoutesData[0].slice(1, inputRoutesData[0].length - 1).split(',');
    inputRoutesData.shift();

    const routeIdIdx = header.findIndex((item) => {return item === 'route_id'});
    const agencyIdIdx = header.findIndex((item) => {return item === 'agency_id'});
    const routeShortNameIdx = header.findIndex((item) => {return item === 'route_short_name'});
    const routeLongNameIdx = header.findIndex((item) => {return item === 'route_long_name'});
    const routeDescIdx = header.findIndex((item) => {return item === 'route_desc'});
    const routeTypeIdx = header.findIndex((item) => {return item === 'route_type'});
    const routeUrlIdx = header.findIndex((item) => {return item === 'route_url'});
    const routeColorIdx = header.findIndex((item) => {return item === 'route_color'});
    const routeTextColorIdx = header.findIndex((item) => {return item === 'route_text_color'});
    const routeSortOrderIdx = header.findIndex((item) => {return item === 'route_sort_order'});
    const continuousPickupIdx = header.findIndex((item) => {return item === 'continuous_pickup'});
    const continuousDropOffIdx = header.findIndex((item) => {return item === 'continuous_drop_off'});
    const networkIdIdx = header.findIndex((item) => {return item === 'network_id'});

    if (routeIdIdx === -1 || routeTypeIdx === -1) {
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
            id: null,
            route_id: decRecord[routeIdIdx] ? decRecord[routeIdIdx] : '',
            agency_id: decRecord[agencyIdIdx] ? decRecord[agencyIdIdx] : '',
            agency_id_id: null,
            route_short_name: decRecord[routeShortNameIdx] ? decRecord[routeShortNameIdx] : '',
            route_long_name: decRecord[routeLongNameIdx] ? decRecord[routeLongNameIdx] : '',
            route_desc: decRecord[routeDescIdx] ? decRecord[routeDescIdx] : '',
            route_type: decRecord[routeTypeIdx] ? parseInt(decRecord[routeTypeIdx]) : -1,
            route_url: decRecord[routeUrlIdx] ? decRecord[routeUrlIdx] : '',
            route_color: decRecord[routeColorIdx] ? decRecord[routeColorIdx] : 'FFFFFF',
            route_text_color: decRecord[routeTextColorIdx] ? decRecord[routeTextColorIdx] : '000000',
            route_sort_order: decRecord[routeSortOrderIdx] ? parseInt(decRecord[routeSortOrderIdx]) : -1,
            continuous_pickup: decRecord[continuousPickupIdx] ? parseInt(decRecord[continuousPickupIdx]) : 1,
            continuous_drop_off: decRecord[continuousDropOffIdx] ? parseInt(decRecord[continuousDropOffIdx]) : 1,
            network_id: decRecord[networkIdIdx] ? decRecord[networkIdIdx] : ''
        }

        if (process.env.BE_PROCESSING_ROUTES === undefined || process.env.BE_PROCESSING_ROUTES !== '') {
            if (!decRecord[routeIdIdx].match(process.env.BE_PROCESSING_ROUTES)) {
                continue;
            }
        } else {
            continue
        }

        let actualRoute = actualActiveRoutes[newRoute.route_id];
        newRoute.id = actualRoute?.id;
        newRoute.agency_id_id = todayAgencyIds[newRoute.agency_id] ? todayAgencyIds[newRoute.agency_id] : null;
        if (actualRoute === undefined || JSON.stringify(actualRoute) !== JSON.stringify(newRoute)) {
                if (actualRoute !== undefined) {
                    if (! await dbPostGIS.makeObjUnActive(actualActiveRoutes[newRoute.route_id].id, 'routes')) {
                        return false;
                    }
                }
    
                todayRouteIds[newRoute.route_id] = {
                    id: await dbPostGIS.addRoute(newRoute),
                    route_type: newRoute.route_type
                }
    
                if (todayRouteIds[newRoute.route_id].id === null) {
                    return false;
                }

                dbStats.updateStateProcessingStats('gtfs_routes_added', 1);
        } else {
            todayRouteIds[newRoute.route_id] = {
                id: actualRoute.id,
                route_type: newRoute.route_type
            }
        }
    }

    dbStats.updateStateProcessingStats('gtfs_routes', Object.keys(todayRouteIds).length);
    return true;
}

// Function for processing routes file
async function getTodayTrips(inputStopTimesFile, inputApiFile, inputTripsFile) {
    if (inputStopTimesFile?.data === undefined) {
        return false;
    }

    // Prepare stop times data
    let inputStopTimesData = inputStopTimesFile.data.toString().split('\n');
    let header = inputStopTimesData[0].slice(1, inputStopTimesData[0].length - 1).split(',');
    inputStopTimesData.shift();

    const tripIdIdx = header.findIndex((item) => {return item === 'trip_id'});
    const arrivalTimeIdx = header.findIndex((item) => {return item === 'arrival_time'});
    const departureTimeIdx = header.findIndex((item) => {return item === 'departure_time'});
    const stopIdx = header.findIndex((item) => {return item === 'stop_id'});
    const locationGroupIdx = header.findIndex((item) => {return item === 'location_group_id'});
    const locationIdx = header.findIndex((item) => {return item === 'location_id'});
    const stopSequenceIdx = header.findIndex((item) => {return item === 'stop_sequence'});
    const stopHeadsignIdx = header.findIndex((item) => {return item === 'stop_headsign'});
    const startPickupDropOffWindowIdx = header.findIndex((item) => {return item === 'start_pickup_drop_off_window'});
    const endPickupDropOffWindowIdx = header.findIndex((item) => {return item === 'end_pickup_drop_off_window'});
    const pickupTypeIdx = header.findIndex((item) => {return item === 'pickup_type'});
    const dropOffTypeIdx = header.findIndex((item) => {return item === 'drop_off_type'});
    const continuousPickupIdx = header.findIndex((item) => {return item === 'continuous_pickup'});
    const continuousDropOffIdx = header.findIndex((item) => {return item === 'continuous_drop_off'});
    const shapeDistTraveledIdx = header.findIndex((item) => {return item === 'shape_dist_traveled'});
    const timepointIdx = header.findIndex((item) => {return item === 'timepoint'});
    const pickupBookingRuleIdIdx = header.findIndex((item) => {return item === 'pickup_booking_rule_id'});
    const dropOffBookingRuleIdIdx = header.findIndex((item) => {return item === 'drop_off_booking_rule_id'});

    if (tripIdIdx === -1 || stopSequenceIdx === -1) {
        return false;
    }

    actualStopTimes = {};

    // Process input stop_times zip data
    // https://gtfs.org/schedule/reference/#stop_timestxt
    for (const record of inputStopTimesData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined) {
            continue;
        }

        if (actualStopTimes[decRecord[tripIdIdx]] === undefined) {
            actualStopTimes[decRecord[tripIdIdx]] = {
                stops_info: [
                    {
                        aT: decRecord[arrivalTimeIdx] ? decRecord[arrivalTimeIdx] : '00:00:00',
                        dT: decRecord[departureTimeIdx] ? decRecord[departureTimeIdx] : '00:00:00',
                        stop_id: decRecord[stopIdx] ? decRecord[stopIdx] : '',
                        stop_sequence: decRecord[stopSequenceIdx] ? parseInt(decRecord[stopSequenceIdx]) : -1,
                        pickup_type: decRecord[pickupTypeIdx] ? parseInt(decRecord[pickupTypeIdx]) : 0,
                        drop_off_type: decRecord[dropOffTypeIdx] ? parseInt(decRecord[dropOffTypeIdx]) : 0
                    }
                ],
                stops: []
            }
        } else {
            actualStopTimes[decRecord[tripIdIdx]].stops_info.push(
                {
                    aT: decRecord[arrivalTimeIdx] ? decRecord[arrivalTimeIdx] : '00:00:00',
                    dT: decRecord[departureTimeIdx] ? decRecord[departureTimeIdx] : '00:00:00',
                    stop_id: decRecord[stopIdx] ? decRecord[stopIdx] : '',
                    stop_sequence: decRecord[stopSequenceIdx] ? parseInt(decRecord[stopSequenceIdx]) : -1,
                    pickup_type: decRecord[pickupTypeIdx] ? parseInt(decRecord[pickupTypeIdx]) : 0,
                    drop_off_type: decRecord[dropOffTypeIdx] ? parseInt(decRecord[dropOffTypeIdx]) : 0
                }
            )
        }
    }

    for (let record in actualStopTimes) {
        actualStopTimes[record].stops_info.sort((recA, recB) => {return recA.stop_sequence > recB.stop_sequence ? 1 : -1});

        let startTime;
        let idx = 0;
        while (actualStopTimes[record].stops_info.length > idx) {
            let stop = actualStopTimes[record].stops_info[idx];
            if (idx === 0) {
                startTime = parseTimeFromGTFS(actualStopTimes[record].stops_info[0].aT);
                stop['aT'] = `${startTime.getHours() < 10 ? '0' + startTime.getHours() : startTime.getHours()}:${startTime.getMinutes() < 10 ? '0' + startTime.getMinutes() : startTime.getMinutes()}:${startTime.getSeconds() < 10 ? '0' + startTime.getSeconds() : startTime.getSeconds()}`;
            } else {
                stop['aT'] = Math.round((parseTimeFromGTFS(stop['aT']).valueOf() - startTime.valueOf()) / 1000);
            }
            stop['dT'] = Math.round((parseTimeFromGTFS(stop['dT']).valueOf() - startTime.valueOf()) / 1000);

            if (todayStopIds[todayStopIdsDict[stop['stop_id']]] === undefined) {
                actualStopTimes[record].stops_info.splice(idx, 1);
            } else {
                actualStopTimes[record].stops.push(todayStopIds[todayStopIdsDict[stop['stop_id']]]);
                idx++;
            }

            delete stop['stop_id'];
            delete stop['stop_sequence'];
        }

        if (actualStopTimes[record].stops_info.length > 1) {
            actualStopTimes[record].stops_info[actualStopTimes[record].stops_info.length - 1].dT = actualStopTimes[record].stops_info[actualStopTimes[record].stops_info.length - 1].aT;
        }
    }

    actualApiEndpoints = {};

    // Prepate API data, Brno transit system feature
    if (inputApiFile) {
        let inputApiData = inputApiFile.data.toString().split('\n');
        inputApiData.shift();

        for (const record of inputApiData) {
            let decRecord = parseOneLineFromInputFile(record);

            try {
                decRecord = decRecord[0].split(' ');
                decRecord[3] = decRecord[3].split('/')[1];
                actualApiEndpoints[decRecord[5]] = decRecord[3];
            } catch(error) {
                continue;
            }
        }
    }

    // Parse input trip data
    // https://gtfs.org/schedule/reference/#tripstxt
    if (inputTripsFile?.data === undefined) {
        return false;
    }

    let inputTripsData = inputTripsFile.data.toString().split('\n');
    header = inputTripsData[0].slice(1, inputTripsData[0].length - 1).split(',');
    inputTripsData.shift();

    const routeIdIdx = header.findIndex((item) => {return item === 'route_id'});
    const tripIdIdxTrips = header.findIndex((item) => {return item === 'trip_id'});
    const serviceIdIdx = header.findIndex((item) => {return item === 'service_id'});
    const tripHeadsignIdx = header.findIndex((item) => {return item === 'trip_headsign'});
    const tripShortNameIdx = header.findIndex((item) => {return item === 'trip_short_name'});
    const directionIdIdx = header.findIndex((item) => {return item === 'direction_id'});
    const blockIdIdx = header.findIndex((item) => {return item === 'block_id'});
    const wheelchairAccessibleIdx = header.findIndex((item) => {return item === 'wheelchair_accessible'});
    const bikesAllowedIdx = header.findIndex((item) => {return item === 'bikes_allowed'});

    if (routeIdIdx === -1 || serviceIdIdx === -1 || tripIdIdxTrips === -1) {
        return false;
    }

    await dbPostGIS.setAllTripAsServed();
    let actualTrips = await dbPostGIS.getActiveTrips(todayRouteIds);
    let tripsToProcess = 0;

    for (const tripId in actualTrips) {
        actualTrips[tripId].tmp_shape_id = `${todayRouteIds[actualTrips[tripId].route_id].route_type}?${JSON.stringify(actualTrips[tripId].stops)}`;
    }

    for (const record of inputTripsData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined || decRecord[routeIdIdx] === undefined || decRecord[tripIdIdxTrips] === undefined) {
            continue;
        }

        if (todayServiceIDs.indexOf(parseInt(decRecord[serviceIdIdx])) === -1 || actualStopTimes[decRecord[tripIdIdxTrips]] === undefined ||
            todayRouteIds[decRecord[routeIdIdx]] === undefined) {
            if (!useAllServices) {
                continue;
            }
        }

        tripsToProcess++;

        let internTripId = `${decRecord[routeIdIdx]}?${actualStopTimes[decRecord[tripIdIdxTrips]].stops_info[0].aT}?${JSON.stringify(actualStopTimes[decRecord[tripIdIdxTrips]]?.stops)}`;

        let newTrip = {
            route_id: decRecord[routeIdIdx] ? decRecord[routeIdIdx] : '',
            route_id_id: null,
            trip_id: decRecord[tripIdIdxTrips] ? decRecord[tripIdIdxTrips] : '',
            trip_headsign: decRecord[tripHeadsignIdx] ? decRecord[tripHeadsignIdx] : '',
            trip_short_name: decRecord[tripShortNameIdx] ? decRecord[tripShortNameIdx] : '',
            direction_id: decRecord[directionIdIdx] ? parseInt(decRecord[directionIdIdx]) : 0,
            block_id: decRecord[blockIdIdx] ? decRecord[blockIdIdx] : '',
            wheelchair_accessible: decRecord[wheelchairAccessibleIdx] ? parseInt(decRecord[wheelchairAccessibleIdx]) : 0,
            bikes_allowed: decRecord[bikesAllowedIdx] ? parseInt(decRecord[bikesAllowedIdx]) : 0,
            shape_id: null,
            stops_info: actualStopTimes[decRecord[tripIdIdxTrips]].stops_info,
            stops: actualStopTimes[decRecord[tripIdIdxTrips]].stops,
            api: ''
        }

        let actualTrip = actualTrips[internTripId];
        newTrip.route_id_id = actualTrip?.route_id_id ? actualTrip.route_id_id : null;
        newTrip.shape_id = actualTrip?.shape_id ? actualTrip.shape_id : null;
        newTrip.api = actualApiEndpoints[newTrip.trip_id] ? actualApiEndpoints[newTrip.trip_id] : null;
        newTrip.trip_id = internTripId;

        let actualTripToCmp = actualTrip ? JSON.parse(JSON.stringify(actualTrip)) : undefined;
        let tripToCmp = JSON.parse(JSON.stringify(newTrip));

        tripToCmp['stops_info'] = JSON.stringify(tripToCmp['stops_info']);
        tripToCmp['stops'] = JSON.stringify(tripToCmp['stops']);
        if (actualTripToCmp !== undefined) {
            actualTripToCmp['stops_info'] = JSON.stringify(actualTripToCmp['stops_info'] ? actualTripToCmp['stops_info'] : undefined);
            actualTripToCmp['stops'] = JSON.stringify(actualTripToCmp['stops'] ? actualTripToCmp['stops'] : undefined);
            delete actualTripToCmp['id'];
            delete actualTripToCmp['tmp_shape_id'];
        }

        if (actualTrip === undefined || JSON.stringify(actualTripToCmp) !== JSON.stringify(tripToCmp)) {
            if (actualTrip !== undefined) {
                if (! await dbPostGIS.makeObjUnActive(actualTrip.id, 'trips')) {
                    return false;
                }
            }

            newTrip.route_id_id = todayRouteIds[newTrip.route_id].id;

            let newTripToAdd = JSON.parse(JSON.stringify(newTrip));
            newTripToAdd['stops_info'] = newTripToAdd['stops_info'].map(value => `'${JSON.stringify(value)}'`);
            let newTripId = await dbPostGIS.addTrip(newTripToAdd);

            if (newTripId === null) {
                return false;
            }

            newTrip.id = newTripId;
            dbStats.updateStateProcessingStats('gtfs_trips_added', 1);
            actualTrips[internTripId] = newTrip;

            let tmpShapeId = `${todayRouteIds[newTrip.route_id].route_type}?${JSON.stringify(newTrip.stops)}`;
            let tmpShapeActualId = null;

            if (actualTrip !== undefined  && actualTrip.tmp_shape_id !== undefined) {
                if (actualTrip.tmp_shape_id === tmpShapeId) {
                    tmpShapeActualId = actualTrip.shape_id;
                    actualTrips[internTripId].tmp_shape_id = tmpShapeId;
                }
            }

            if (tmpShapeActualId === null) {
                for (const tripId in actualTrips) {
                    if (actualTrips[tripId].tmp_shape_id === tmpShapeId) {
                        tmpShapeActualId = actualTrips[tripId].shape_id;
                        break;
                    }
                }
            }

            if (tmpShapeActualId === null) {
                let interRouteType = '';
                // Reduction of transit modes, currently only tram, rail and road modes are supported
                switch (todayRouteIds[newTrip.route_id].route_type) {
                    case 0: case 4: interRouteType = 'tram'; break;
                    case 2: interRouteType = 'rail'; break;
                    case 3: case 11: case 800: interRouteType = 'road'; break;
                    default: interRouteType = '';
                }

                tmpShapeId = `${interRouteType}?${JSON.stringify(newTrip.stops)}`;

                if (shapesToCalc[tmpShapeId] === undefined) {
                    shapesToCalc[tmpShapeId] = {
                        route: newTrip.route_id,
                        stops: newTrip.stops,
                        trip_ids: [newTripId],
                        transportMode: interRouteType
                    }
                } else {
                    shapesToCalc[tmpShapeId].trip_ids.push(newTripId);
                }
            } else {
                await dbPostGIS.updateTripsShapeId([newTripId], tmpShapeActualId);
            }

            if (! await dbPostGIS.setTripAsUnServed(newTripId)) {
                return false;
            }
        } else {
            if (! await dbPostGIS.setTripAsUnServed(actualTrip.id)) {
                return false;
            }
        }
    }

    dbStats.updateStateProcessingStats('gtfs_trips', Object.keys(actualTrips).length);
    dbStats.updateStateProcessingStats('trips_to_process', tripsToProcess);
    return true;
}

// Function for decoding which services should be operated today
function getTodayServices(inputCalendarFile, inputDatesFile) {
    todayServiceIDs = [];
    let today = timeStamp.getTodayUTC();
    today.setUTCHours(0, 0, 0, 0);
    const dayOfWeek = today.getUTCDay() === 0 ? 6 : today.getUTCDay() - 1;

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

                if (decRecord[dayOfWeek + 1] === '1' && start.getTime() <= today.getTime() && today.getTime() <= end.getTime()) {
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

                let date = timeStamp.getDateFromISOTimeStamp(decRecord[1]);
                if (decRecord[2] === '1' && date.getTime() === today.getTime()) {
                    try {
                        if (!todayServiceIDs.find((itm) => { return itm === parseInt(decRecord[0])})) {
                            todayServiceIDs.push(parseInt(decRecord[0]));
                        }
                    } catch (error) {}
                } else if (decRecord[2] === '2' && date.getTime() === today.getTime()) {
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

// Routing handle function
// From proposed data model, every trip needs its shape, trip definition in physical space
// This function call routing module for every new shape based on actual stop positions and stop order in actual trips
async function getNewShapes() {
    return new Promise(async (resolve) => {
        let progress = 0;
        let lastProgressValue = 0;
        let startTime = performance.now();

        for (const task in shapesToCalc) {
            let retVal = await routingService.computeShape(shapesToCalc[task]);
            progress += (1 / Object.keys(shapesToCalc).length) * 100;
            if (Math.floor(progress) > lastProgressValue) {
                lastProgressValue = Math.floor(progress);
                log('info', `Routing shapes, progress: ${lastProgressValue}%`);
            }

            if (!retVal) {
                resolve(false);
                return;
            }

            dbStats.updateStateProcessingStats('gtfs_shapes_added', 1);
        }

        dbStats.updateStateProcessingStats('routing_time', performance.now() - startTime);
        dbStats.updateStateProcessingStats('routing_done', true);

        resolve(true);
        return;
    });
}

// Util functions
// Try to create JS Date format from GTFS input data
function parseDateFromGTFS(input) {
    input = `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}`;

    try {
        return new timeStamp.getDateFromISOTimeStamp(input);
    } catch(error) {
        return new Date('1970-01-01');
    }
}

// Try to parse time from GTFS input data
function parseTimeFromGTFS(input) {
    try {
        if (parseInt(input.slice(0,2)) < 10) {
            return new Date(`1970-01-01T0${input}`);
        } else if (parseInt(input.slice(0,2)) > 23) {
            input = `${(parseInt(input.slice(0,2)) - 24).toString()}:${input.slice(3,5)}:${input.slice(6,8)}`;
            if (parseInt(input.slice(0,2)) < 10) {
                return new Date(`1970-01-02T0${input}`);
            } else {
                return new Date(`1970-01-02T${input}`);
            }
        } else {
            return new Date(`1970-01-01T${input}`);
        }
    } catch(error) {
        return new Date('1970-01-01T00:00:00');
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

function stopsSort(data) {
    data.sort(function(x, y) {
        if (x.stop_name.toLowerCase() < y.stop_name.toLowerCase()) {
          return -1;
        }
        if (x > y) {
          return 1;
        }
        return x.latLng.toString() < y.latLng.toString() ? -1 : 1;
      });
    return data;
}

module.exports = { reloadActualSystemState }