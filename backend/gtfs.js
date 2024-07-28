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
    stop.id = actualStop?.id;

    stop.parent_station_id = actualStop?.parent_station_id ? actualStop.parent_station_id : null;
    let actualStopToCmp = actualStop ? JSON.parse(JSON.stringify(actualStop)) : undefined;
    let stopToCmp = JSON.parse(JSON.stringify(stop));
    delete stopToCmp['child_stops'];

    if (actualStop === undefined || JSON.stringify(actualStopToCmp) !== JSON.stringify(stopToCmp) || replace) {
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
                stop['aT'] = startTime.toLocaleTimeString();
            } else {
                stop['aT'] = Math.round((parseTimeFromGTFS(stop['aT']).valueOf() - startTime.valueOf()) / 1000);
            }
            stop['dT'] = Math.round((parseTimeFromGTFS(stop['dT']).valueOf() - startTime.valueOf()) / 1000);

            if (todayStopIds[stop['stop_id']] === undefined) {
                actualStopTimes[record].stops_info.splice(idx, 1);
            } else {
                actualStopTimes[record].stops.push(todayStopIds[stop['stop_id']]);
                idx++;
            }

            delete stop['stop_id'];
            delete stop['stop_sequence'];
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

    let actualTrips = await dbPostGIS.getActiveTrips();

    for (const record of inputTripsData) {
        let decRecord = parseOneLineFromInputFile(record);

        if (decRecord === undefined || decRecord[routeIdIdx] === undefined || decRecord[tripIdIdxTrips] === undefined) {
            continue;
        }

        if (todayServiceIDs.indexOf(parseInt(decRecord[serviceIdIdx])) === -1 || actualStopTimes[decRecord[tripIdIdxTrips]] === undefined ||
            todayRouteIds[decRecord[routeIdIdx]] === undefined) {
            continue;
        }

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
        }


        if (actualTrip === undefined || JSON.stringify(actualTripToCmp) !== JSON.stringify(tripToCmp)) {
            if (actualTrip !== undefined) {
                if (! await dbPostGIS.makeObjUnActive(actualTrip.id, 'trips')) {
                    return false;
                }
            }

            newTrip.route_id_id = todayRouteIds[newTrip.route_id];

            newTrip['stops_info'] = newTrip['stops_info'].map(value => `'${JSON.stringify(value)}'`);
            let newTripId = await dbPostGIS.addTrip(newTrip);

            if (newTripId === null) {
                return false;
            }

            // TO DO
            // Zarad trip do query na trasovanie
        }

        // TO DO
        // Vytvor zaznam v StatsDB, ktory neskor vyplnia spracovane data
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

// Try to parse time from GTFS input data
function parseTimeFromGTFS(input) {
    try {
        if (parseInt(input.slice(0,2)) < 10) {
            return new Date(`1970-01-01T0${input}`);
        } else if (parseInt(input.slice(0,2)) > 24) {
            input = `${(parseInt(input.slice(0,2)) - 24).toString()}:${input.slice(2,4)}:${input.slice(4,6)}`;
            return new Date(`1970-01-02T${input}`);
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

module.exports = { reloadActualSystemState }