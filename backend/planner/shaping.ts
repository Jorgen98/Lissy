/*
 * File: shaping.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for providing shapes from the database to trip legs.
 */

const gtfsService = require('../gtfs.js');

import { calculateDistanceHaversine } from "./geo";
import { LatLng } from "./types/LatLng";
import polyline from '@mapbox/polyline';
import { TripOption, TripSectionLeg } from "./types/TripOption";

// Main entry point for filling in the trip shape of an option
export async function fillInTripShape(trip: TripOption): Promise<void> {

    // Get a flat list of legs on the trip
    const legs = trip.sections.flatMap(section => section.legs);

    // Process shapings of all legs in the trip concurrently
    const legShapings: Promise<void>[] = [];
    legs.forEach(leg => legShapings.push(getLegShape(leg)));
    await Promise.all(legShapings);

    // Recalculate distances with new shapes
    trip.distance = 0;
    trip.sections.forEach(section => {
        const distance = section.legs.reduce((sum, leg) => sum + leg.distance, 0);
        section.distance = distance;
        trip.distance += distance;
    });

    trip.hasFullShape = true;
}

// Function accessing the database to get full shape of a leg and its new distance from that shape
async function getLegShape(leg: TripSectionLeg): Promise<void> {

    // Need valid route and trip objects with gtfs ids
    if (leg.route === null || leg.trip === null || leg.route.gtfsId === null || leg.trip.gtfsId === null)
        return;

    // Get existing shape from database
    const shape = await gtfsService.getShapeFromOTP(leg.route.gtfsId, leg.trip.gtfsId);
    if (shape === undefined || shape.stops === undefined || shape.coords === undefined)
        return;

    // The found shape has coordinates for the whole trip used for the leg, need only a subsection of the shape for the actual leg
    const subshape = getSubShape(leg, shape);
    if (subshape === null)
        return;

    leg.points = subshape;
    leg.distance = calculateLegDistance(leg.points);
}

// Function decoding google polyline to array of lat/lng coordinate object with mapbox package
export function translateGooglePolyline(encoded: string, precision?: number): LatLng[] {

    // Use mapbox package to get a list of number tuples
    const decoded = polyline.decode(encoded, precision);

    // Convert into list of lat/lng objects
    return decoded.map(tuple => ({
        lat: tuple[0],
        lng: tuple[1],
    }));
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