/*
 * GTFS data function file
 *
 * Author: Juraj Lazur (ilazur@fit.vut.cz)
 * Contributors: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
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
const dbCache = require('./db-cache.js');

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

// Function calculating a transit accessibility score for each stop loaded from GTFS
async function getStopTransitAccessibilityScores(stopsFile, stopTimesFile, tripsFile, calendarFile, routesFile) {

    // Check valid data in all necessary files
    if (stopsFile?.data === undefined || stopTimesFile?.data === undefined || tripsFile?.data === undefined || calendarFile?.data === undefined || routesFile?.data === undefined)
        return false;

    // Get line-by-line data from each CSV file (includes header)
    let stopsData = stopsFile.data.toString().split('\n');
    let stopTimesData = stopTimesFile.data.toString().split('\n');
    let routesData = routesFile.data.toString().split('\n');
    let tripsData = tripsFile.data.toString().split('\n');
    let calendarData = calendarFile.data.toString().split('\n');

    // Get header form each CSV file 
    const stopsHeader = stopsData[0].slice(1, stopsData[0].length - 1).split(','); stopsData.shift();
    const stopTimesHeader = stopTimesData[0].slice(1, stopTimesData[0].length - 1).split(','); stopTimesData.shift();
    const routesHeader = routesData[0].slice(1, routesData[0].length - 1).split(','); routesData.shift();
    const tripsHeader = tripsData[0].slice(1, tripsData[0].length - 1).split(','); tripsData.shift();
    const calendarHeader = calendarData[0].slice(1, calendarData[0].length - 1).split(','); calendarData.shift();

    // Create lookup tables with Map for fast lookup
    const serviceDaysCnt = createServiceDaysCntMap(calendarHeader, calendarData);
    const tripInfo = createTripInfoMap(tripsHeader, tripsData);
    const modeWeights = createModeWeightsMap(routesHeader, routesData);
    const stopTrips = createStopTripsMap(stopTimesHeader, stopTimesData);

    // Calculate transit accessibility for each stop
    const stopScores = calculateScores(stopsHeader, stopsData, stopTrips, tripInfo, serviceDaysCnt, modeWeights);

    // Aggregate the only to stops that have parentId set to null (group together stops from the same hub)
    const stopScoresAggregated = aggregateScoresToParents(stopScores);

    // Normalize scores to 0-100 range
    const result = normalizeScores(stopScoresAggregated);
    if (result === null)
        return false;

    // Update the database with calculated scores
    console.log("Start");
    let count = 0;
    for (const [_, data] of Object.entries(stopScoresAggregated)) {
        const stopId = `0:${data.name}:${data.lat}:${data.lng}`;
        const score = data.normalizedScore;
        await dbPostGIS.updateStopTransitScore(stopId, score);
        console.log("Count: " + count);
        count++;
    }
    console.log("End");

    return true;
}

// Function normalizing the calculated scores to a logarithmic 0-100 range
function normalizeScores(stopScoresAggregated) {

    // Get maximum score to normalize against
    const maxScore = Math.max(...Object.values(stopScoresAggregated).map(stop => stop.score));
    if (maxScore === 0)
        return null;

    // Add normalized score property to each stop object
    for (const [_, data] of Object.entries(stopScoresAggregated)) {

        if (data.score === 0)
            data["normalizedScore"] = 0;
        else {

            // Normalize score against the maximum value with a logarithmic range
            const normScore = (Math.log10(data.score) / Math.log10(maxScore)) * 100;
            data["normalizedScore"] = Math.round(normScore);
        }
    }
}

// Function aggregating the calculated scores of stops from the same hub to only one parent stop
function aggregateScoresToParents(stopScores) {

    const stopEntries = Object.entries(stopScores);

    // Find stops which are the parent stops in the hierarchy and set up object with their ids (these dont have calculated scores)
    let stopScoresAggregated = {};
    for (const [stopId, stopInfo] of stopEntries) {
        if (stopInfo.parentId === null)
            stopScoresAggregated[stopId] = { name: stopInfo.name, score: 0, lat: stopInfo.lat, lng: stopInfo.lng };
    }

    // Aggregate the calculated scores to the previously created object from the parent stop by parentId
    for (const [_, stopInfo] of stopEntries) {
        if (stopInfo.parentId !== null)
            stopScoresAggregated[stopInfo.parentId]["score"] += stopInfo.score;
    }

    return stopScoresAggregated;
}

// Function calculating the transit accessibility score of stops from stops.txt 
function calculateScores(stopsHeader, stopsData, stopTrips, tripInfo, serviceDaysCnt, modeWeights) {

    // Get all necessary indicies from the order of the stops.txt header
    const stopIdIdx = stopsHeader.findIndex(item => item === 'stop_id');
    const stopNameIdx = stopsHeader.findIndex(item => item === 'stop_name');
    const parentIdIdx = stopsHeader.findIndex(item => item === 'parent_station');
    const latIdx = stopsHeader.findIndex(item => item === 'stop_lat');
    const lngIdx = stopsHeader.findIndex(item => item === 'stop_lon');

    let stopScores = {};
    let stopCount = 0;
    const stopsLen = stopsData.length;

    // Iterate through all stops.txt records and calculate the score
    for (const stopRecord of stopsData) { 
        const stop = parseOneLineFromInputFile(stopRecord);
        if (!stop) continue;

        const stopId = stop[stopIdIdx];
        const stopName = stop[stopNameIdx];
        const parentId = stop[parentIdIdx] !== '' ? stop[parentIdIdx] : null; 
        
        // Get ids of trips passing through this stop from the map
        const tripIds = stopTrips.get(stopId) || [];
        
        // Iterate through the tripIds, group them by routeId and accumulate total weekly trips for each route
        const routeWeeklyTrips = new Map();        
        for (const tripId of tripIds) {
            const info = tripInfo.get(tripId); 
            if (!info) continue;
            
            const routeId = info.routeId;
            const days = serviceDaysCnt.get(info.serviceId) || 0;  
            
            // Add the number of days in service in a week to map keyed by route id
            routeWeeklyTrips.set(
                routeId, 
                (routeWeeklyTrips.get(routeId) || 0) + days // Add to current total
            );
        }
        
        // Calculate the stop score by multiplying each routes weekly trip number by the mode weight
        let totalScore = 0;
        for (const [routeId, tripsCnt] of routeWeeklyTrips) {
            const modeWeight = modeWeights.get(routeId) || 1.5;
            totalScore += tripsCnt * modeWeight;
        }
        
        // Add the score for this stop to the final object 
        stopScores[stopId] = {
            name: stopName,
            score: totalScore,
            lat: parseFloat(stop[latIdx]),
            lng: parseFloat(stop[lngIdx]),
            parentId: parentId,     // Parent stop id for later aggregation
        };

        // Progress indicator
        stopCount++;
        if (stopCount % 3000 === 0)
            log('info', `Transit Score calculated for ${stopCount}/${stopsLen} stops...`);
    }

    return stopScores;
}

// Function creating a lookup table which maps trip_id's from stop_times.txt to the stop_id stop_times.txt
function createStopTripsMap(stopTimesHeader, stopTimesData) {

    // Get all necessary indicies from the order of the stop_times.txt header
    const stopIdIdx = stopTimesHeader.findIndex(item => item === 'stop_id');
    const tripIdIdx = stopTimesHeader.findIndex(item => item === 'trip_id');

    // Iterate through all stop_times.txt records to build the map
    const stopTrips = new Map();
    for (const stopTimesRecord of stopTimesData) {
        const stopTime = parseOneLineFromInputFile(stopTimesRecord);
        if (!stopTime) continue;
        
        const stopId = stopTime[stopIdIdx];
        const tripId = stopTime[tripIdIdx];
        
        // Create new map entry for given stop id if it does not exist yet and add trip id to map
        if (!stopTrips.has(stopId))
            stopTrips.set(stopId, []);
        stopTrips.get(stopId).push(tripId);
    }

    return stopTrips;
}

// Function creating a lookup table which maps route_id from routes.txt to the transit accessibility score weight of the mode it uses
function createModeWeightsMap(routesHeader, routesData) {

    // Get all necessary indicies from the order of the routes.txt header
    const routeTypeIdx = routesHeader.findIndex(item => item === 'route_type');
    const routeIdIdx = routesHeader.findIndex(item => item === 'route_id');

    // Iterate through all routes.txt records to build the map
    const modeWeights = new Map();
    for (const routeRecord of routesData) {
        const route = parseOneLineFromInputFile(routeRecord);
        if (!route) continue;
        
        const routeId = route[routeIdIdx];
        const mode = Number(route[routeTypeIdx]);
        
        // Default weight is 1.5, only changes for light/heavy rail (0, 1, 2) and buses (3)
        let modeWeight = 1.5;
        if (mode === 3) modeWeight = 1;       
        else if (mode === 0 || mode === 1 || mode === 2) modeWeight = 2;
        
        // Store the weight in the map keyed by route_id
        modeWeights.set(routeId, modeWeight);
    }

    return modeWeights;
}

// Function creating a lookup table which maps trip_id from trips.txt to its route_id and service_id
function createTripInfoMap(tripsHeader, tripsData) {

    // Get all necessary indicies from the order of the trips.txt header
    const routeIdIdx = tripsHeader.findIndex(item => item === 'route_id');
    const serviceIdIdx = tripsHeader.findIndex(item => item === 'service_id');
    const tripIdIdx = tripsHeader.findIndex(item => item === 'trip_id');

    // Iterate through all trips.txt records to build the map
    const tripInfo = new Map();
    for (const tripRecord of tripsData) {
        const trip = parseOneLineFromInputFile(tripRecord);
        if (!trip) continue;
        
        // Store route and service ids into the map keyed by trip_id
        tripInfo.set(trip[tripIdIdx], {
            routeId: trip[routeIdIdx],
            serviceId: trip[serviceIdIdx]
        });
    }

    return tripInfo;
}

// Function creating a lookup table which maps service_id from calendar.txt to the number of days in a week that service is active
function createServiceDaysCntMap(calendarHeader, calendarData) {

    // Get all necessary indicies from the order of the calendar.txt header
    const serviceIdIdx = calendarHeader.findIndex(item => item === 'service_id');
    const mondayIdx = calendarHeader.findIndex(item => item === 'monday');
    const tuesdayIdx = calendarHeader.findIndex(item => item === 'tuesday');
    const wednesdayIdx = calendarHeader.findIndex(item => item === 'wednesday');
    const thursdayIdx = calendarHeader.findIndex(item => item === 'thursday');
    const fridayIdx = calendarHeader.findIndex(item => item === 'friday');
    const saturdayIdx = calendarHeader.findIndex(item => item === 'saturday');
    const sundayIdx = calendarHeader.findIndex(item => item === 'sunday');
    const startIdx = calendarHeader.findIndex(item => item === 'start_date');
    const endIdx = calendarHeader.findIndex(item => item === 'end_date');

    // Iterate through all calendar.txt records to build the map
    const serviceDaysCnt = new Map();
    for (const calendarRecord of calendarData) {
        const calendar = parseOneLineFromInputFile(calendarRecord);
        if (!calendar) continue;
        
        // Get start and end days of the service as JS Date objects
        const start = calendar[startIdx];
        const end = calendar[endIdx];
        const startDate = new Date(parseInt(start.slice(0, 4)), parseInt(start.slice(4, 6)) - 1, parseInt(start.slice(6, 8)));
        const endDate = new Date(parseInt(end.slice(0, 4)), parseInt(end.slice(4, 6)) - 1, parseInt(end.slice(6, 8)));
        const today = new Date();

        // If the service is not currently active, dont include it in the map
        if (today < startDate || today > endDate)
            continue;

        // Get number of days in week the service is active for
        const numDays = 
            Number(calendar[mondayIdx]) +
            Number(calendar[tuesdayIdx]) +
            Number(calendar[wednesdayIdx]) +
            Number(calendar[thursdayIdx]) +
            Number(calendar[fridayIdx]) +
            Number(calendar[saturdayIdx]) +
            Number(calendar[sundayIdx]);
        
        // Store in map keyed by the service_id
        const serviceId = calendar[serviceIdIdx];
        serviceDaysCnt.set(serviceId, numDays);
    }

    return serviceDaysCnt;
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
                        !inputFiles.find((file) => { return file.path === 'trips.txt'}) || 
                        !inputFiles.find((file) => { return file.path === 'calendar.txt'})) {
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

                    // Calculate transit accessibility scores of each stop for the planner
                    const stops = inputFiles.find(file => file.path === 'stops.txt');
                    const stopTimes = inputFiles.find(file => file.path === 'stop_times.txt');
                    const trips = inputFiles.find(file => file.path === 'trips.txt');
                    const calendar = inputFiles.find(file => file.path === 'calendar.txt');
                    const routes = inputFiles.find(file => file.path === 'routes.txt');
                    if (!await getStopTransitAccessibilityScores(stops, stopTimes, trips, calendar, routes)) {
                        log('error', 'Failed to calculate stop transit scores from GTFS due to corrupted files');
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
                            shapesToCalc = {};
                            return;
                        }
                        log('success', 'Shapes routing done');
                        shapesToCalc = {};

                        if (saveTestOutput) {
                            fs.writeFile(`backups/${(new Date()).toISOString()}_shapes.txt`, JSON.stringify(await dbPostGIS.getShapes()), function(error) {
                                if (error) {
                                    log('error', error);
                                }
                            });
                        }
                    }
                    dbStats.updateStateProcessingStats('gtfs_shapes', await dbPostGIS.countShapes());

                    // Today shapes API endpoint reset
                    await dbCache.clearTodayShapes();
                    await dbCache.setUpTodayShapes();

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
        let actualRoute = 0;

        for (const task in shapesToCalc) {
            if (shapesToCalc[task].route !== actualRoute) {
                actualRoute = shapesToCalc[task].route;
                log('info', `Routing shapes of route ${actualRoute}`);
            }
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