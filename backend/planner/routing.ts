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

export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripSectionOption[] | null> {

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
            const driveDistEstimate = distance * 1.4;
            const walkDistEstimate = distance * 1.2;

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
            if (driveDistEstimate > 1500) {
                plannerRequests.push(
                    planner.getTripSection(
                        createSectionRequest(request, ["car"])
                    )
                );
            }
        }

        // TODO If car and public trasnport are both selected, decide if a CAR->transfer->TRANSIT options should be requested
        /*if (globalModes.publicTransport && globalModes.car) {
            // TODO calculation to decide if a CAR->transfer->TRANSIT trip makes sense
            // If pointA is some rural town/stop (can check timetables, or stop density in the near area or something else), it might make sense to make a car trip to a bigger transport hub
            // If pointB is in the middle of the city, it doesnt really make sense to take a car trip to public transport when public transport can be used from the start anyway
        }*/

        // Wait for all created requests running in parallel
        const results = await Promise.all(plannerRequests);

        // Filter out unsuccessful requests
        const foundOptions = results.filter(result => result !== null);

        // TODO Filter, deduplicate, rank, ... all options and find TOP 3

        // Flatten the 2D list returned by Promise.all into one 1D list with all trips
        return foundOptions.flat();
    }

    // TODO handle trip with midpoints
    return null;
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
            }
        }
    }
}

// Function using the haversine formula to calculate straight line distance between two points in meters
function calculateDistanceHaversine(pointA: { lat: number, lng: number }, pointB: { lat: number, lng: number }): number {

    // Earth radius (meters)
    const r = 6_371_000;

    // Convert lat/lng degrees to radians
    const pointALat = pointA.lat * Math.PI / 180;
    const pointBLat = pointB.lat * Math.PI / 180;
    const latDelta = (pointB.lat - pointA.lat) * Math.PI / 180;
    const lngDelta = (pointB.lng - pointA.lng) * Math.PI / 180;

    // Calculate haversine of omega (central angle between the two points on a sphere)
    const cos = Math.cos;
    const havOmega = (1 - cos(latDelta) + cos(pointALat) * cos(pointBLat) * (1 - cos(lngDelta))) / 2;

    // Calculate central angle between the two points on a sphere
    const omega = 2 * Math.asin(Math.sqrt(havOmega));

    // Calculate distance between two points in meters
    return r * omega;
}