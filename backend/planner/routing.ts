/*
 * File: routing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Function for routing and building a response to a trip request using the planner adapter.
 */

const dbPostgis = require('../db-postgis.js');

import { TransportMode } from "../../frontend/modules/planner/types/TransportMode";
import { RoutePlanner } from "./RoutePlanner";
import { TripRequest } from "./types/TripRequest";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { WALKING_DISTANCE_COEF, DRIVING_DISTANCE_COEF, MIN_DRIVE_DISTANCE, SCORE_STOP_RADIUS, PARK_AND_RIDE_DECISION_SCORE, PARK_AND_RIDE_DECISION_DISTANCE } from "./utils/coefficients";
import { calculateDistanceHaversine } from "./geo";
import { TripOption, TripSectionOption } from "./types/TripOption";

export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Perform possible initialization steps
    if (!await planner.initialize())
        return null;

    // Call planning function based on number of trip points
    let tripOptions: TripOption[] | null = [];
    if (request.points.length === 2)
        tripOptions = await planTripWithoutMidpoints(request, planner);
    else 
        tripOptions = await planTripWithMidpoints(request, planner);
    if (tripOptions === null)
        return null;

    // Add place names to sections origins and destinations based on the data from trip request
    addPlaceNames(tripOptions, request);

    return tripOptions;
}

async function planTripWithMidpoints(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // The sections need to be built in reverse if arrival time is selected
    const reverseOrder = request.datetime.datetimeOption === "arrival";

    // Datetime that should be used as departure/arrival time for the next section
    let followingDatetime = request.datetime.tripDatetime;

    // Accumulators for total distance, duration and sections of the trip
    let totalDistance = 0;
    let totalDuration = 0;
    let tripSections: TripSectionOption[] = []; 

    for (
        let i = reverseOrder ? request.points.length - 1 : 0; 
        reverseOrder ? i > 0 : i < request.points.length - 1;
        reverseOrder ? i-- : i++
    ) {

        // Get modes selected to be used for this section 
        const sectionModes = request.modes.sections[reverseOrder ? i - 1 : i]!;

        // Get coordinates of the start and end points of the section
        const pointA = request.points[reverseOrder ? i - 1 : i]!;
        const pointB = request.points[reverseOrder ? i : i + 1]!;

        // Get one mode selected for this section
        // NOTE: Always just one for now
        const selectedMode = Object.keys(sectionModes).find(mode => sectionModes[mode as TransportMode]) as TransportMode;

        // Call OTP service to get one option with given parameters 
        // NOTE: Always just one for now
        const foundSections = await planner.getTripSection(
            createSectionRequest(request, pointA, pointB, [selectedMode], followingDatetime), 1
        );    
        if (!foundSections || foundSections[0] === undefined)
            return null;
        const section = foundSections[0];

        // Datetime of the next/previous section will be the ending/starting dateTime of the previous/next
        followingDatetime = (reverseOrder ? section.startDatetime : section.endDatetime).toISOString();

        // Accumulate distance, duration and sections in the right order
        reverseOrder ? tripSections.unshift(section) : tripSections.push(section);
        totalDistance += section.distance;
        totalDuration += section.duration;
    } 

    // Build final array of options
    // NOTE: Always one for now
    const options = [{
        distance: totalDistance,
        duration: totalDuration,
        sections: tripSections,
        startDatetime: tripSections[0]!.startDatetime,
        endDatetime: tripSections[tripSections.length - 1]!.endDatetime,
    }];

    // Filter out unsatisfactory trip options by request parameters
    const filteredOptions = filterOptions(options, request);

    return filteredOptions;
} 

async function planTripWithoutMidpoints(request: TripRequest, planner: RoutePlanner): Promise<TripOption[]> {

    // Get modes used in request for less object access
    const globalModes = request.modes.global;

    // List of promises from requests to the planner so Promise.all can be used
    let plannerRequests = []; 

    const origin = request.points[0]!;
    const destination = request.points[1]!;

    // Always get trip options with public transport section if selected
    if (globalModes.publicTransport) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(request, origin, destination, ["publicTransport"], request.datetime.tripDatetime)
            )
        );
    }

    // If only one direct mode (car or walk) is selected, get trip sections for that mode
    if ((globalModes.car && !globalModes.walk) || (!globalModes.car && globalModes.walk)) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(request, origin, destination, [globalModes.car ? "car" : "walk"], request.datetime.tripDatetime)
            )
        );
    }

    // If both direct modes (car and walk) are selected, decide on point distance (straight line) if they both make sense
    if (globalModes.car && globalModes.walk)
        carWalkCombination(request, plannerRequests, planner);

    // If car and public trasnport are both selected, decide if a CAR->transfer->TRANSIT options should be requested
    if (globalModes.publicTransport && globalModes.car) {

        // Get scores of the origin and destination points, and straight line distance between them
        const originScore = await getPointTransitAccessScore(origin.lat, origin.lng);
        const destinationScore = await getPointTransitAccessScore(destination.lat, destination.lng);
        const distance = calculateDistanceHaversine(origin, destination);

        if (distance >= PARK_AND_RIDE_DECISION_DISTANCE) {
            if (originScore < PARK_AND_RIDE_DECISION_SCORE && destinationScore >= PARK_AND_RIDE_DECISION_SCORE) {
                // Make car->transit request
            }
            else if (originScore < PARK_AND_RIDE_DECISION_SCORE && destinationScore < PARK_AND_RIDE_DECISION_SCORE) {
                // If theres a good transit hub between the two points
                    // Make car->transit request
            }
            else if (originScore >= PARK_AND_RIDE_DECISION_SCORE && destinationScore < PARK_AND_RIDE_DECISION_SCORE) {
                // If theres a good transit hub between the two points that is closer to the destination than the origin
                    // Make car->transit request
            }
        }
    }

    // Wait for all created requests running in parallel
    const results = await Promise.all(plannerRequests);

    // Filter out unsuccessful requests and flatten the 2D list returned by Promise.all into one 1D list with all options
    const foundOptions = results.filter(result => result !== null).flat();

    // Deduplicate public transport options that have the same legs as another option, which departs earlier/later (depending on departure or arrival time)
    const deduplicatedOptions = deduplicateOptions(foundOptions, request.datetime.datetimeOption === "arrival");

    // Flatten the filtered 2D list into one 1D list of TripOptions
    const tripOptions = deduplicatedOptions.map(option => ({
        distance: option.distance,
        duration: option.duration,
        endDatetime: option.endDatetime,
        sections: [option], // Simply a trip option with one section
        startDatetime: option.startDatetime
    }));

    // Filter out unsatisfactory trip options by request parameters
    const filteredOptions = filterOptions(tripOptions, request);

    // TODO Rank options

    return filteredOptions;
}

// Function getting the transit score of an arbitrary point 
async function getPointTransitAccessScore(lat: number, lng: number) {

    // Find stations that are in a given radius from the point
    const nearbyStations = await dbPostgis.getNearbyStations(lat, lng, SCORE_STOP_RADIUS);

    // Find the maximum score from the nearby stops
    let maxScore = 0;
    for (const data of Object.values(nearbyStations) as any) {
        const stationScore = data.transit_score as number;
        if (stationScore > maxScore)
            maxScore = stationScore;
    }

    return maxScore;
}

// Function filtering public transport section options that are the same as another option but departure is later/earlier (depending on departure or arrival time selection)
function deduplicateOptions(options: TripSectionOption[], reverseOrder: boolean): TripSectionOption[] {

    // Sort the options by departure time ascending if using departure time or by arrival time descending if using arrival time
    const optionsSorted = !reverseOrder ? 
        options.sort((a, b) => a.startDatetime.getTime() - b.startDatetime.getTime()) :
        options.sort((a, b) => b.endDatetime.getTime() - a.endDatetime.getTime());

    // Accumulator for section identifiers that have already been seen
    let seen = new Set<string>();

    // Accumulate and check seen ids for every option
    return optionsSorted.filter(option => {
        const id = buildSectionOptionId(option);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

// Function creating an id that is unique to sections that have the same legs
function buildSectionOptionId(option: TripSectionOption): string {

    // Start with distance and duration of the option
    let id = `${String(Math.round(option.distance))}_${String(Math.round(option.duration))}`;

    // Append information about each leg to the string
    option.legs.forEach(leg => {
        id += `_${leg.mode}_${Math.round(leg.distance)}_${Math.round(leg.duration)}_${leg.from.placeName}_${leg.to.placeName}`;
    });

    return id;
}

function carWalkCombination(request: TripRequest, plannerRequests: Promise<TripSectionOption[] | null>[], planner: RoutePlanner) {

    // Get straight line distance between the two points using haversine function
    const distance = calculateDistanceHaversine(request.points[0]!, request.points[1]!);

    // Get driving distance and walking distance estimates
    // TODO play around with coefficients
    const driveDistEstimate = distance * DRIVING_DISTANCE_COEF;
    const walkDistEstimate = distance * WALKING_DISTANCE_COEF;

    // If the maximum walking distance is more than the estimate or not limited, create a walk request for the section
    if (request.preferences.walk.maxDistance === null || walkDistEstimate <= request.preferences.walk.maxDistance) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(request, request.points[0]!, request.points[1]!, ["walk"], request.datetime.tripDatetime)
            )
        );
    }

    // If the distance is too short, it might not make sense to get car options
    // TODO decide on correct threshold
    if (driveDistEstimate > MIN_DRIVE_DISTANCE) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(request, request.points[0]!, request.points[1]!, ["car"], request.datetime.tripDatetime)
            )
        );
    }
}

// Function filtering the plain list of found options
function filterOptions(options: TripOption[], request: TripRequest): TripOption[] {

    // Get maximum walking distance from request object
    const maxWalkDistance = request.preferences.walk.maxDistance;

    // Run each trip options through filters
    return options.filter(option => {

        // Filter out options with legs longer then maximum set walking distance
        if (maxWalkDistance !== null) {
            for (const section of option.sections) {
                for (const leg of section.legs) {
                    if (leg.mode === "WALK" && leg.distance > maxWalkDistance)
                        return false;
                }
            }
        }
        
        // Option passed all filters
        return true;
    });
} 

// Function adding place names to section origin points and destination points where they arent yet set
function addPlaceNames(options: TripOption[], request: TripRequest): void {

    // Go through each section
    options.forEach(option => {
        option.sections.forEach((section, index) => {
            
            // Get the possible new names for section origin and destination from the request
            const originPointName = request.points[index]!.placeName;
            const destPointName = request.points[index + 1]!.placeName;

            // Update the section origin name if its available and not set yet
            if (originPointName !== undefined && section.originName === null) 
                section.originName = originPointName;

            // Same with destination
            if (destPointName !== undefined && section.destinationName === null) 
                section.destinationName = destPointName;

            // If the origin of the first leg doesnt have a name, can fill with the origin name of the section
            if (originPointName !== undefined && section.legs[0]!.from.placeName === null)
                section.legs[0]!.from.placeName = originPointName;

            // Same with destination of the last legs and section destination name
            if (destPointName !== undefined && section.legs[section.legs.length - 1]!.to.placeName === null)
                section.legs[section.legs.length - 1]!.to.placeName = destPointName;
        });
    });
}

// Function creating the section request object for the planner adapter
function createSectionRequest(
    request: TripRequest,
    pointA: { lat: number, lng: number }, 
    pointB: { lat: number, lng: number }, 
    modes: TransportMode[], 
    datetime: string 
): TripSectionInfo {
    return {
        pointA,
        pointB,
        modes: modes,
        datetime: {
            option: request.datetime.datetimeOption,
            datetime
        },
        preferences: {
            walk: {
                speed: request.preferences.walk.avgSpeed,
            },
            publicTransport: {
                allowedModes: request.preferences.publicTransport.allowedModes
            }
        }
    }
}