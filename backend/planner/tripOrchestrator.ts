/*
 * File: tripOrchestrator.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for handling the requesting, building and filtering full trips.
 * Entry point to the trip planning process.
 */

const dbPostgis = require('../db-postgis.js');
const logService = require('../log.js');

import { TripRequest } from "./types/TripRequest";
import { RoutePlanner } from "./RoutePlanner";
import { TripOption, TripSectionOption } from "./types/TripOption";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { getSectionOptions } from "./sectionOrchestrator";
import { UserPreferences } from "../../frontend/modules/planner/types/TripDataExtended";
import { fillInTripShape } from "./shaping";
import { findReturnTrips } from "./returnTrips";
import { PlannerConfig } from "./types/PlannerConfig";
import { MAX_RETURNED_OPTIONS } from "./utils/systemConstants";
import { RerouteRequest } from "./types/RerouteRequest";
import { 
    addNumberOfTransfers, 
    getParetoOptimalTrips, 
    postprocessTripOptions, 
    postprocessTripSections, 
    rateOptions 
} from "./postprocessing";

function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

export let plannerConfig: PlannerConfig | null = null;
async function loadPlannerConfig() {
    if (!process.env.BE_PLANNER_CONFIG_NAME) {
        log("error", "Missing environment variable with planner configuration name");
        return;
    }

    plannerConfig = await dbPostgis.getPlannerConfig(process.env.BE_PLANNER_CONFIG_NAME);
}

// Trip routing entry point function
export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Perform possible initialization steps
    if (!await planner.initialize())
        return null;

    // Load config from DB
    await loadPlannerConfig();
    if (!plannerConfig)
        return null;

    // Get list of trip options 
    const tripOptions = await getTripOptions(request, planner);
    if (tripOptions === null)
        return null;

    // Apply postprocessing operations to all trip options
    await postprocessTripOptions(tripOptions, request);

    // Filter out unsatisfactory trip options by given user preferences
    const filteredOptions = filterOptions(tripOptions, request.preferences);

    // Get only pareto-optimal options
    const paretoOptions = getParetoOptimalTrips(filteredOptions);

    // Add a score to all options using the custom scoring system
    rateOptions(paretoOptions);

    // Fill in trip shapes for all options from the DB
    for (const option of paretoOptions)
        await fillInTripShape(option);

    // Find return trips for all options if requested 
    if (request.return.active)
        await findReturnTrips(planner, paretoOptions, request);

    // Create a selection of the top found options by different criteria
    return createSelection(paretoOptions, request.datetime.datetimeOption);
}

// Function returning a list of TripOption objects
async function getTripOptions(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Get information from the trip request, for less access to the request object
    const { datetime, preferences, points, modes } = request;

    // Handle special case where there are exactly three points in the request
    if (points.length === 3) 
        return await getTripOptionsWithOneMidpoint(request, planner);

    // The sections need to be built in reverse if arrival time is selected
    const reverseOrder = datetime.datetimeOption === "arrival";

    // Use the globally set modes for a trip that has no midpoints
    const useGlobalModes = points.length === 2;

    // Datetime that should be used as departure/arrival time for the next section
    let followingDatetime = datetime.tripDatetime;

    // Accumulators for total distance, duration, emissions and sections of the trip
    let totalDistance = 0;
    let totalDuration = 0;
    let totalEmissions = 0;
    const tripSections: TripSectionOption[] = []; 

    // Change the order of iteration based on the reverseOrder variable set earlier
    // Iterates the trip points from behind for trips that have latest arrival time selected
    for (
        let i = reverseOrder ? points.length - 1 : 0; 
        reverseOrder ? i > 0 : i < points.length - 1;
        reverseOrder ? i-- : i++
    ) {
        // Get modes to be used for this section 
        const sectionModes = useGlobalModes ? modes.global : modes.sections[reverseOrder ? i - 1 : i]!;

        // Get coordinates of the start and end points of the section
        const pointA = points[reverseOrder ? i - 1 : i]!;
        const pointB = points[reverseOrder ? i : i + 1]!;

        // Create request object for the section
        const sectionRequest: TripSectionInfo = {
            pointA,
            pointB,
            preferences,
            modes: sectionModes,
            datetime: {
                datetime: followingDatetime,
                option: datetime.datetimeOption,
            },
            isReroute: false,
        }
        
        // Request options for this section with created request object
        const foundSections = await getSectionOptions(planner, sectionRequest);
        if (foundSections.length === 0)
            return null;

        // If its a trip request without midpoints, return all found section options wrapped in a TripOption object
        // Otherwise get only the best rated found section
        if (points.length === 2) {
            return foundSections.map(section => ({
                distance: section.distance,
                duration: section.duration,
                endDatetime: section.endDatetime,
                startDatetime: section.startDatetime,                
                sections: [section],
                numTransfers: 0, // Calculated in postprocessing
                emissions: section.emissions,
                cost: null, // Calculated in postprocessing
                score: null, // Calculated in postprocessing,
                fastest: false,
                cheapest: false,
                best: false,
                returnTrip: {
                    section: null,
                    hasShape: false,
                },
            }));
        }

        // Postprocess, rate and sort by rating
        await postprocessTripSections(foundSections, request.preferences);
        rateOptions(foundSections);
        foundSections.sort((a, b) => b.score! - a.score!);

        // Get best rated option
        const section = foundSections[0]!;

        // Datetime of the next/previous section will be the ending/starting dateTime of the previous/next
        followingDatetime = (reverseOrder ? section.startDatetime : section.endDatetime).toISOString();

        // Accumulate distance, duration and sections in the right order
        reverseOrder ? tripSections.unshift(section) : tripSections.push(section);
        totalDistance += section.distance;
        totalDuration += section.duration;
        totalEmissions += section.emissions!;
    } 

    // Accumulate time spent waiting on midpoints to total trip duration
    for (let i = 0; i < tripSections.length - 1; i++) {
        const arriveToMidpoint = tripSections[i]!.endDatetime;
        const departFromMidpoint = tripSections[i+1]!.startDatetime;
        const secondsAtMidpoint = (departFromMidpoint.getTime() - arriveToMidpoint.getTime()) / 1000;
        totalDuration += secondsAtMidpoint; 
    }

    // Build final array of options
    const options = [{
        distance: totalDistance,
        duration: totalDuration,
        sections: tripSections,
        startDatetime: tripSections[0]!.startDatetime,
        endDatetime: tripSections[tripSections.length - 1]!.endDatetime,
        numTransfers: 0, // Calculated in prostprocessing
        emissions: totalEmissions,
        cost: null, // Calculated in prostprocessing
        score: null, // Calculated in prostprocessing
        fastest: false,
        cheapest: false,
        best: false,
        returnTrip: { 
            section: null,
            hasShape: false,
        },
    }];

    return options;
} 

// Function handliung the special case where there are three points in the request
// Find the top three first sections and for each one, finds the top three seconds sections
async function getTripOptionsWithOneMidpoint(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {
    const { datetime, preferences, points, modes } = request;

    // The sections need to be built in reverse if arrival time is selected
    const reverseOrder = datetime.datetimeOption === "arrival";

    // Request the first section options
    // If datetime option is arrive by, this is actually chronologically the second section in the trip
    const firstSections = await getSectionOptions(planner, {
        pointA: reverseOrder ? points[1]! : points[0]!,
        pointB: reverseOrder ? points[2]! : points[1]!,
        preferences,
        modes: modes.sections[reverseOrder ? 1 : 0]!,
        datetime: {
            datetime: datetime.tripDatetime,
            option: datetime.datetimeOption,
        },
        isReroute: false,
    });
    if (firstSections.length === 0) return null;

    // Rate the found sections and get only the top three
    await postprocessTripSections(firstSections, preferences);
    rateOptions(firstSections);
    firstSections.sort((a, b) => b.score! - a.score!);
    const topFirstSections = firstSections.slice(0, 3);

    // Accumulator for built trip options from two sections
    const tripOptions: TripOption[] = [];

    // Iterate over every one of the top first sections and find second sections for each one
    for (const firstSection of topFirstSections) {

        // Get datetime of the next secion based on the reverseOrder flag
        const nextDatetime = reverseOrder
            ? firstSection.startDatetime.toISOString()
            : firstSection.endDatetime.toISOString();

        // Request a list of second section in the trip 
        const secondSections = await getSectionOptions(planner, {
            pointA: reverseOrder ? points[0]! : points[1]!,
            pointB: reverseOrder ? points[1]! : points[2]!,
            preferences,
            modes: modes.sections[reverseOrder ? 0 : 1]!,
            datetime: {
                datetime: nextDatetime,
                option: datetime.datetimeOption,
            },
            isReroute: false,
        });

        // No need to exit the function here, only silently ignore the current first section
        if (secondSections.length === 0) continue;

        // Rank and get top three of the found second sections
        await postprocessTripSections(secondSections, preferences);
        rateOptions(secondSections);
        secondSections.sort((a, b) => b.score! - a.score!)
        const topSecondSections = secondSections.slice(0, 3);

        // Iterate over the found top second sections and build final TripOption objects
        for (const secondSection of topSecondSections) {

            // Put the sections in actual chronological order
            const sectionsOrdered = reverseOrder
                ? [secondSection, firstSection]
                : [firstSection, secondSection];

            // Get the time that is spent waiting on the midpoint between the two sections in seconds 
            const waitSeconds = (sectionsOrdered[1]!.startDatetime.getTime() - sectionsOrdered[0]!.endDatetime.getTime()) / 1000;

            // Build a full TripOption object from the two sections
            tripOptions.push({
                distance: sectionsOrdered[0]!.distance + sectionsOrdered[1]!.distance,
                duration: sectionsOrdered[0]!.duration + sectionsOrdered[1]!.duration + waitSeconds,
                sections: sectionsOrdered,
                startDatetime: sectionsOrdered[0]!.startDatetime,
                endDatetime: sectionsOrdered[1]!.endDatetime,
                numTransfers: 0,
                emissions: sectionsOrdered[0]!.emissions! + sectionsOrdered[1]!.emissions!,
                cost: null,
                score: null,
                fastest: false,
                cheapest: false,
                best: false,
                returnTrip: { section: null, hasShape: false },
            });
        }
    }

    return tripOptions;
}

// Function filtering the plain list of found trip options
function filterOptions(options: TripOption[], preferences: UserPreferences): TripOption[] {

    // Get values from request object
    const maxWalkDistance = preferences.walk.maxDistance;
    const maxTransfers = preferences.publicTransport.maxTransfers;

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

        // Filter out options with number of transfers higher than maximum set in user settings
        if (maxTransfers !== null) {
            if (option.numTransfers > maxTransfers)
                return false;
        }
        
        // Option passed all filters
        return true;
    });
}

// Function creating a selection of trip options to be returned from a list of candidate options
function createSelection(candidates: TripOption[], datetimeOption: "arrival" | "departure"): TripOption[] {

    // If theres less candidates than the maximum number of returned options, return them all
    if (candidates.length < MAX_RETURNED_OPTIONS)
        return candidates;

    // Append an identifier to each candidate
    const candidatesWithIds = candidates.map((candidate, idx) => ({
        ...candidate,
        id: idx
    }));

    // Find best trip options in a couple different criteria
    const leaders = findLeaders(candidatesWithIds, datetimeOption);

    // Deduplicate the leaders using a map (one option could be best in more criteria)
    const selectedMap = new Map<number, TripOption & { id: number }>();
    leaders.forEach(leader => {
        selectedMap.set(leader.id, leader);
    });

    // How many more options can be added to fill MAX_RETURNED_OPTIONS
    let wildcardsToAdd = MAX_RETURNED_OPTIONS - Array.from(selectedMap.values()).length;

    // Sort by score
    candidatesWithIds.sort((a, b) => b.score! - a.score!);

    // Fill map until MAX_RETURNED_OPTIONS is reached or until there are no more options with best scored unique options
    for (const candidate of candidatesWithIds) {
        if (wildcardsToAdd === 0)
            break;
        if (!selectedMap.has(candidate.id)) {
            selectedMap.set(candidate.id, candidate);
            wildcardsToAdd--;
        }
    } 

    // Convert the selection in the map into an array
    return Array.from(selectedMap.values());
}

function findLeaders(candidates: (TripOption & { id: number })[], datetimeOption: "arrival" | "departure"): (TripOption & { id: number })[] {

    // Object with leaders for each of the selected criteria
    const leaders: Record<string, TripOption & { id: number }> = {
        fastest: candidates[0]!,        
        best: candidates[0]!,        
        cheapest: candidates[0]!,        
        departure: candidates[0]!,        
        arrival: candidates[0]!,        
    };

    // Iterate through all candidates, find leaders in each category
    candidates.forEach(candidate => {

        // Check if the current candidate is so far the fastest
        if (candidate.duration < leaders.fastest!.duration)
            leaders.fastest = candidate; 

        // Check if the current candidate is so far the best by score
        if (candidate.score! > leaders.best!.score!)
            leaders.best = candidate; 

        // Check if the current candidate is so far the cheapest
        if (candidate.cost! < leaders.cheapest!.cost!)
            leaders.cheapest = candidate; 

        // Check if the current candidate has the earliest departure so far
        if (candidate.startDatetime.getTime() < leaders.departure!.startDatetime.getTime())
            leaders.departure = candidate; 

        // Check if the current candidate has the earliest/latest arrival so far
        // Earliest arrival is used if the user selected depart after
        // Latest arrival is used if the user selected arrive by
        if (datetimeOption === "departure" && candidate.endDatetime.getTime() < leaders.arrival!.endDatetime.getTime())
            leaders.arrival = candidate;
        else if (datetimeOption === "arrival" && candidate.endDatetime.getTime() > leaders.arrival!.endDatetime.getTime())
            leaders.arrival = candidate;
    });

    return Object.values(leaders);
}

// Function rerouting a single section in a trip, returns a new adjusted trip object (or null if rerouting fails)
export async function rerouteLegInTrip(planner: RoutePlanner, rerouteRequest: RerouteRequest): Promise<{ trip: TripOption, legDiff: number } | null> {
    
    // The original trip object the request was put into
    const originalTrip = rerouteRequest.originalTrip;

    // Section of the original trip which contains the rerouted leg
    const originalSection = originalTrip.sections[rerouteRequest.sectionIdx]; 

    // The to be rerouted leg
    const originalLeg = originalSection?.legs[rerouteRequest.legIdx];
    if (!originalLeg)
        return null;

    // Original emissions value in the section
    const originalEmissions = originalSection?.emissions;

    // Count the number of legs in the original trip before reroute
    const originalLegCount = originalTrip.sections.flatMap(section => section.legs).length;

    // Get direction of the reroute request
    const direction = rerouteRequest.direction;

    // Get the datetime that should be used for the new leg, either moved one minute forward or backward based on the direction
    const datetime = new Date(
        new Date(
            direction === "next" ? originalLeg.from.departureTime : originalLeg.to.arrivalTime
        ).getTime() + 1000 * 60 * (direction === "next" ? 1 : -1)
    ).toISOString()

    // Get new options for the leg with same origin and destination points
    // For direction === "next", at least one minute later departure than the original
    // For direction === "next", at least one minute eariler arrival than the original
    const newLegOptions = await planner.getTripSection({
        pointA: originalLeg.from.latLng,
        pointB: originalLeg.to.latLng,
        modes: { car: false, publicTransport: true, walk: false },
        preferences: rerouteRequest.originalRequest.preferences,
        datetime: {
            option: direction === "next" ? "departure" : "arrival",
            datetime, 
        },
        isReroute: true, 
    });
    if (newLegOptions === null || newLegOptions.length === 0)
        return null;

    // Filter out routes that have a walking leg longer than the selected maximum
    const filtered = filterReroutesWalkDistance(newLegOptions, rerouteRequest.originalRequest.preferences.walk.maxDistance);
    if (filtered.length === 0)
        return null;

    // Sort by earliest or latest arrival based on the reroute direction and get first
    if (direction === "next")
        filtered.sort((a, b) => a.startDatetime.getTime() - b.startDatetime.getTime());
    else
        filtered.sort((a, b) => b.startDatetime.getTime() - a.startDatetime.getTime());
    const newOption = filtered[0]!;

    // Replace the original leg with the new leg (or legs)
    originalSection.legs.splice(rerouteRequest.legIdx, 1, ...newOption.legs);

    // Recalculate distance, emissions and number of transfers in the section
    originalSection.distance = originalSection.distance - originalLeg.distance + newOption.distance; 
    originalSection.emissions = null;
    await postprocessTripSections([originalSection], rerouteRequest.originalRequest.preferences, false);

    // Recalculate distance, emissions and number of transfers in the full trip
    originalTrip.distance = originalTrip.distance - originalLeg.distance + newOption.distance;
    originalTrip.emissions = originalTrip.emissions! - originalEmissions! + originalSection.emissions!;
    addNumberOfTransfers(rerouteRequest.originalTrip.sections.flatMap(section => section.legs), rerouteRequest.originalTrip);  

    // Recalculate trip shape
    await fillInTripShape(rerouteRequest.originalTrip);

    // Return the rereouted trip with difference in legs against the original
    return { trip: originalTrip, legDiff: originalTrip.sections.flatMap(section => section.legs).length - originalLegCount };
}

// Function filtering out found sections in rerouting that have walking legs longer than the maximum
function filterReroutesWalkDistance(options: TripSectionOption[], maxWalkDistance: number | null): TripSectionOption[] {
    if (maxWalkDistance === null)
        return options;

    return options.filter(option => {
        for (const leg of option.legs) {
            if (leg.mode === "WALK" && leg.distance > maxWalkDistance)
                return false;
        }
        return true;
    });
}