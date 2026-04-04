/*
 * File: tripOrchestrator.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for handling the requesting, building and filtering full trips.
 * Entry point to the trip planning process.
 */

const dbPostgis = require('../db-postgis.js');

import { TripRequest } from "./types/TripRequest";
import { RoutePlanner } from "./RoutePlanner";
import { TripOption, TripSectionOption } from "./types/TripOption";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { getSectionOptions } from "./sectionOrchestrator";
import { UserPreferences } from "../../frontend/modules/planner/types/TripDataExtended";
import { fillInTripShape } from "./shaping";
import { findReturnTrips } from "./returnTrips";
import { getParetoOptimalTrips, postprocessTripOptions, rateOptions } from "./postprocessing";
import { PlannerConfig } from "./types/PlannerConfig";
import { MAX_RETURNED_OPTIONS } from "./utils/systemConstants";

export let plannerConfig: PlannerConfig | null = null;
async function loadPlannerConfig() {
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
            }
        }
        
        // Request options for this section with created request object
        const foundSections = await getSectionOptions(planner, sectionRequest);
        if (foundSections.length === 0)
            return null;

        // If its a trip request without midpoints, return all found section options wrapped in a TripOption object
        // Otherwise get only the first found section option 
        // TODO will be changed when ranking is introduced
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