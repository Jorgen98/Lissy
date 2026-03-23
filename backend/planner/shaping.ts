/*
 * File: shaping.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for providing shapes from the database to existing trip options.
 */

const gtfsService = require('../gtfs.js');

import { TripOption } from "./types/TripOption";
import { TripSectionLeg } from "./types/TripOption";
import { calculateDistanceHaversine } from "./geo";
import { LatLng } from "./types/LatLng";

// Main entry point for filling in the trip shape of an option
export async function fillInTripShape(trip: TripOption): Promise<void> {

    // Accumulator for total trip distance
    let tripDistance = 0

    // Iterate through all sections and their legs
    for (const section of trip.sections) {

        // Accumulator for total distance of the section
        let sectionDistance = 0;
        for (const leg of section.legs) {

            // Get the full leg shape and new distance from DB
            const { points, distance } = await getLegShape(leg);

            // Accumulate the distance, use old value if new one couldnt be calculated
            if (distance !== null) {
                leg.distance = distance;
                sectionDistance += distance;
            }
            else 
                sectionDistance += leg.distance;

            // Update the leg points if the shape was available
            if (points !== null)
                leg.points = points;
        }

        // Update distance of section and accumulate distance of entire trip
        section.distance = sectionDistance;
        tripDistance += sectionDistance;
    }

    // Set new trip distance, and set a flag that the shape has already been calculated
    trip.distance = tripDistance;
    trip.hasFullShape = true;
}

// Function accessing the database to get full shape of a leg and its new distance from that shape
async function getLegShape(leg: TripSectionLeg): Promise<{ points: LatLng[] | null, distance: number | null }> {

    // Need valid route and trip objects with gtfs ids
    if (leg.route === null || leg.trip === null || leg.route.gtfsId === null || leg.trip.gtfsId === null)
        return { points: null, distance: null };

    // Get existing shape from database
    const shape = await gtfsService.getShapeFromOTP(leg.route.gtfsId, leg.trip.gtfsId);
    if (shape === undefined || shape.stops === undefined || shape.coords === undefined)
        return { points: null, distance: null };

    // The found shape has coordinates for the whole trip used for the leg, need only a subsection of the shape for the actual leg
    const subshape = getSubShape(leg, shape);
    if (subshape === null)
        return { points: null, distance: null };

    // Return the points and calculate the new leg distance from the new points
    return { points: subshape, distance: calculateLegDistance(subshape) };
}

// Function for calculating the distance of a leg from its point coordinates
function calculateLegDistance(points: LatLng[]): number {
    let distance = 0;
    for (let i = 0; i < points.length - 1; i++)
        distance += calculateDistanceHaversine(points[i]!, points[i+1]!);

    return distance;
}

// Get a subsection of 'shape', which is the shape of 'leg'
function getSubShape(leg: TripSectionLeg, shape: any): LatLng[] | null {

    // Get names of stops where the leg starts and ends
    const legFrom = leg.from.placeName;
    const legTo = leg.to.placeName;
    if (legFrom === null || legTo === null)
        return null;

    // Find start and end indicies of subshape of the trip shape corresponding to the leg
    const legStartIdx = (shape.stops as { stop_name: string }[]).findIndex(stop => stop.stop_name === legFrom);
    const legEndIdx = (shape.stops as { stop_name: string }[]).findIndex(stop => stop.stop_name === legTo);
    if (legStartIdx === -1 || legEndIdx === -1)
        return null;

    // Flatten the shape structure into a 1D list of lat, lng objects 
    let coords: LatLng[] = [];
    for (let idx = legStartIdx; idx < legEndIdx; idx++) {
        const interStopCoords = shape.coords[idx];
        for (const coord of interStopCoords) {
            coords.push({
                lat: coord[0],
                lng: coord[1]
            });
        }
    }

    return coords;
}