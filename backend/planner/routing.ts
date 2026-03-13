/*
 * File: routing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Function for routing and building a response to a trip request using the planner adapter.
 */

import { TransportMode } from "../../frontend/modules/planner/types/TransportMode";
import { RoutePlanner } from "./RoutePlanner";
import { TripRequest } from "./types/TripRequest";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { WALKING_DISTANCE_COEF, DRIVING_DISTANCE_COEF, MIN_DRIVE_DISTANCE } from "./utils/coefficients";
import { calculateDistanceHaversine } from "./geo";
import { TripOption, TripSectionOption } from "./types/TripOption";

export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Perform possible initialization steps
    await planner.initialize();

    // Specific case where there are only two trip points in the plan
    if (request.points.length === 2) {

        // Get modes used in request for less object access
        const globalModes = request.modes.global;

        // List of promises from requests to the planner so Promise.all can be used
        let plannerRequests = []; 

        // Always get trip options with public transport section if selected
        if (globalModes.publicTransport) {
            plannerRequests.push(
                planner.getTripSection(
                    createSectionRequest(request, request.points[0]!, request.points[1]!, ["publicTransport"], request.datetime.tripDatetime)
                )
            );
        }

        // If only one direct mode (car or walk) is selected, get trip sections for that mode
        if ((globalModes.car && !globalModes.walk) || (!globalModes.car && globalModes.walk)) {
            plannerRequests.push(
                planner.getTripSection(
                    createSectionRequest(request, request.points[0]!, request.points[1]!, [globalModes.car ? "car" : "walk"], request.datetime.tripDatetime)
                )
            );
        }

        // If both direct modes (car and walk) are selected, decide on point distance (straight line) if they both make sense
        if (globalModes.car && globalModes.walk) {

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

        // If car and public trasnport are both selected, decide if a CAR->transfer->TRANSIT options should be requested
        if (globalModes.publicTransport && globalModes.car) {
            // TODO decide if the CAR->transfer->TRANSIT trip should be requested based on rurality
        }

        // Wait for all created requests running in parallel
        const results = await Promise.all(plannerRequests);

        // Filter out unsuccessful requests and flatten the 2D list returned by Promise.all into one 1D list with all options
        const foundOptions = results.filter(result => result !== null).flat();

        // Flatten the filtered 2D list into one 1D list of TripOptions
        const tripOptions = foundOptions.map(option => ({
            distance: option.distance,
            duration: option.duration,
            endDatetime: option.endDatetime,
            sections: [option], // Simply a trip option with one section
            startDatetime: option.startDatetime
        }));

        // Filter out unsatisfactory trip options by request parameters
        const filteredOptions = filterOptions(tripOptions, request);

        // TODO Filter, deduplicate, rank options

        return filteredOptions;
    }
    else {

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

        // Return final trip option object with accumulated distance, duration, sections and get start and end datetimes
        return [{
            distance: totalDistance,
            duration: totalDuration,
            sections: tripSections,
            startDatetime: tripSections[0]!.startDatetime,
            endDatetime: tripSections[tripSections.length - 1]!.endDatetime,
        }]
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