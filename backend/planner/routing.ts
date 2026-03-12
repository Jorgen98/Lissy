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
import { TripSectionOption } from "./types/TripSectionOption";
import { WALKING_DISTANCE_COEF, DRIVING_DISTANCE_COEF, MIN_DRIVE_DISTANCE } from "./utils/coefficients";
import { calculateDistanceHaversine } from "./geo";

export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripSectionOption[] | null> {

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
                    createSectionRequest(request, ["publicTransport"])
                )
            );
        }

        // If only one direct mode (car or walk) is selected, get trip sections for that mode
        if ((globalModes.car && !globalModes.walk) || (!globalModes.car && globalModes.walk)) {
            plannerRequests.push(
                planner.getTripSection(
                    createSectionRequest(request, [globalModes.car ? "car" : "walk"])
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
                        createSectionRequest(request, ["walk"])
                    )
                );
            }

            // If the distance is too short, it might not make sense to get car options
            // TODO decide on correct threshold
            if (driveDistEstimate > MIN_DRIVE_DISTANCE) {
                plannerRequests.push(
                    planner.getTripSection(
                        createSectionRequest(request, ["car"])
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

        // Filter out unsatisfactory trip options by request parameters
        const filteredOptions = filterOptions(foundOptions, request);

        // TODO Filter, deduplicate, rank, ... all options and find TOP 3

        // Flatten the 2D list returned by Promise.all into one 1D list with all trips
        return filteredOptions.flat();
    }

    // TODO handle trip with midpoints
    return null;
}

// Function filtering the plain list of found options
function filterOptions(options: TripSectionOption[], request: TripRequest): TripSectionOption[] {

    // Get maximum walking distance from request object
    const maxWalkDistance = request.preferences.walk.maxDistance;

    // Run each trip options through filters
    return options.filter(option => {

        // Filter out options with legs longer then maximum set walking distance
        if (maxWalkDistance !== null) {
            for (const leg of option.legs) {
                if (leg.mode === "WALK" && leg.distance > maxWalkDistance)
                    return false;
            }
        }
        
        // Option passed all filters
        return true;
    });
} 

// Function creating the section request object for the planner adapter
function createSectionRequest(request: TripRequest, modes: TransportMode[]): TripSectionInfo {
    return {
        pointA: request.points[0]!,
        pointB: request.points[1]!,
        modes: modes,
        datetime: {
            option: request.datetime.datetimeOption,
            date: request.datetime.tripDate,
            time: request.datetime.tripTime   
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