/*
 * File: tripOrchestrator.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for handling the requesting, building and filtering full trips.
 * Entry point to the trip planning process.
 */

import { TripRequest } from "./types/TripRequest";
import { RoutePlanner } from "./RoutePlanner";
import { TripOption, TripSectionOption } from "./types/TripOption";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { getSectionOptions } from "./sectionOrchestrator";
import { UserPreferences } from "../../frontend/modules/planner/types/TripDataExtended";
import { fillInTripShape } from "./shaping";
import { 
    addPlaceNames, 
    getParetoOptimalTrips, 
    postprocessTripOptions, 
    postprocessTripSections, 
    rateOptions 
} from "./postprocessing";


// Trip routing entry point function
export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Perform possible initialization steps
    if (!await planner.initialize())
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

    return paretoOptions;
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
                hasFullShape: false,
                sections: [section],
                numTransfers: 0, // Calculated in postprocessing
                emissions: section.emissions,
                cost: null, // Calculated in postprocessing
                score: null, // Calculated in postprocessing,
                fastest: false,
                cheapest: false,
                best: false,
                returnTrip: null,
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
        hasFullShape: false,
        numTransfers: 0, // Calculated in prostprocessing
        emissions: totalEmissions,
        cost: null, // Calculated in prostprocessing
        score: null, // Calculated in prostprocessing
        fastest: false,
        cheapest: false,
        best: false,
        returnTrip: null,
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

// Function attempting to find return trips for each trip option
async function findReturnTrips(planner: RoutePlanner, options: TripOption[], request: TripRequest) {

    // Create variables for return trips that involve either only car or only public transport
    // They will be the same every time, so no need to request repeatedly
    let carReturnTrip: TripSectionOption | null | "not available" = null;
    let ptReturnTrip: TripSectionOption | null | "not available" = null;

    for (const trip of options) {
        // Check if the arrival time of the original trip is earlier than the requested return datetime
        if (trip.endDatetime.getTime() > new Date(request.return.datetime).getTime())
            trip.returnTrip = "not available";

        // Find place where car was left last
        const legs = trip.sections.flatMap(section => section.legs);
        const lastCarLeg = legs.findLast(leg => leg.mode === "CAR");

        // If theres no car leg on the trip, find best public transport section
        if (!lastCarLeg) {
            if (ptReturnTrip === null)
                ptReturnTrip = await findReturnTripPTOnly(planner, request, trip.endDatetime);
            trip.returnTrip = ptReturnTrip;
        }
        else {

            // Find spot where car was left at and last leg of the trip
            const carLeftAt = lastCarLeg.to.latLng;
            const lastLeg = legs[legs.length - 1];

            // If the last leg of the trip terminates at the same place the car was left at
            // Find a strictly car trip section, since that is definitely what was used for the original trip
            if (carLeftAt.lat === lastLeg!.to.latLng.lat && carLeftAt.lng === lastLeg!.to.latLng.lng) {
                if (carReturnTrip === null)
                    carReturnTrip = await findReturnTripCarOnly(planner, request, trip.endDatetime);
                trip.returnTrip = carReturnTrip;
            }

            // Otherwise TODO 
            else {
                // If departure time option is selected for return trip
                    // Get transit to carLeftAt, rate the options, and select the best one
                    // Connect a car trip from carLeftAt to origin
                // If arrival time option is selected
                    // Fetch car leg that arrives at origin from carLeftAt at given time first
                    // Then request transit options that arrive at carLeftAt before the car leg
                    // Find ones that leave after the arrival time of the original trip
                    // Rate them and pick best one
                    // Shift the car leg forwards so it connects exactly to the end time of the transit leg
            }
        }
        if (trip.returnTrip !== "not available" && trip.returnTrip !== null)
            addPlaceNames({ ...trip, sections: [trip.returnTrip] }, request, true);
        // TODO add shapes to return trips (dont compute more times if not necessary for same option)
    }
}

// Function finding a return trip that uses only public transport
async function findReturnTripPTOnly(planner: RoutePlanner, request: TripRequest, tripArrival: Date): Promise<TripSectionOption | "not available"> {

    // Call RoutePlanner to get public transport sections between destination and origin
    const ptSections = await planner.getTripSection({
        pointA: request.points[request.points.length - 1]!,
        pointB: request.points[0]!,
        datetime: { datetime: request.return.datetime, option: request.return.datetimeOption },
        modes: { car: false, walk: false, publicTransport: true },
        preferences: request.preferences,
    });
    if (!ptSections || ptSections.length === 0)
        return "not available";

    // Filter out options that leave earlier than the original trip arrived
    const filtered = ptSections.filter(sec => sec.startDatetime.getTime() > tripArrival.getTime())
    if (filtered.length === 0)
        return "not available";

    // Call postprocessing to get data for rating, rate, and sort by calculated rating
    await postprocessTripSections(filtered, request.preferences);
    rateOptions(filtered);
    filtered.sort((a, b) => b.score! - a.score!);

    // Pick best option
    return filtered[0]!;
}

// Function finding a return trip that uses only car
async function findReturnTripCarOnly(planner: RoutePlanner, request: TripRequest, tripArrival: Date): Promise<TripSectionOption | "not available"> {

    // Call RoutePlanner to get car sections between destination and origin
    const carSections = await planner.getTripSection({
        pointA: request.points[request.points.length - 1]!,
        pointB: request.points[0]!,
        datetime: { datetime: request.return.datetime, option: request.return.datetimeOption },
        modes: { car: true, walk: false, publicTransport: false },
        preferences: request.preferences,
    });
    if (!carSections || carSections[0] === undefined)
        return "not available";

    // Get first (only) car section and check if it leaves after the arrival of the original trip
    const carSection = carSections[0];
    if (carSection.startDatetime.getTime() < tripArrival.getTime())
        return "not available";

    return carSection;
}