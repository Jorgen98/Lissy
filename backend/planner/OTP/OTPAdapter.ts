/*
 * File: OTPAdapter.ts
 * Author: Adam Vcelar (xvcelaa00) 
 *
 * Translating adapter class for OpenTripPlanner.
 */

const timestamp = require('../../timestamp.js');
const logService = require('../../log.js');
const dbStats = require('../../db-stats.js');
const dbPostgis = require('../../db-postgis.js');
const dbCache = require('../../db-cache.js');

import { OTPService } from "./OTPService";
import { RoutePlanner } from "../RoutePlanner";
import { TripSectionInfo } from "../types/TripSectionInfo";
import { PlanConnectionParams } from "./types/PlanConnectionParams";
import { PlanDirectMode } from "./types/PlanDirectMode";
import { PlanTransitModePreferenceInput } from "./types/PlanTransitModePreferenceInput";
import { TripSectionOption, TripSectionLeg } from "../types/TripSectionOption";
import { Edges, Leg } from "./types/PlanConnectionResponse";
import polyline from '@mapbox/polyline';
import { RouteWithShapes } from "../types/RouteWithShapes";
import { Mode } from "../types/Mode";
import { Node } from "./types/PlanConnectionResponse";

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

/* 
Adapter for OpenTripPlanner2 instance
*/
export class OTPAdapter implements RoutePlanner {

    constructor(
        private otpService: OTPService
    ) { }

    // Get a route between two points using OTPs planConnection function
    // Function translating the inputs to the format needed by OTP and the outputs to the format needed by client
    // Returns a list of found trip options from the OTP request
    public async getTripSection(sectionInfo: TripSectionInfo, numOptions?: number): Promise<TripSectionOption[] | null>  {

        // Which of the possible transport modes should be used in this sections planning
        const usePublicTransport = sectionInfo.modes.some(mode => mode === "publicTransport"); 
        const useWalk = sectionInfo.modes.some(mode => mode === "walk");
        const useCar = sectionInfo.modes.some(mode => mode === "car");

        // Limit to only transit or direct planning based on selected modes
        const transitOnly = usePublicTransport && !useCar && !useWalk;
        const directOnly = !usePublicTransport;

        // Create list of OTP valid objects for public transport modes based on user preferences
        const transitModes = usePublicTransport ? this.getAllowedTransitModes(sectionInfo.preferences.publicTransport.allowedModes) : null;

        // Select one direct mode, since OTP only allows one
        // NOTE: Right now this doesnt matter, since requests from routing.ts are made with exactly one mode anyway
        const directModes: PlanDirectMode[] | null = transitOnly ? null : (useCar ? ["CAR"] : ["WALK"]);

        // Create datetime string in ISO-8601 format, needed by OTP
        const datetime = `${sectionInfo.datetime.date}T${sectionInfo.datetime.time}:00${timestamp.getLocalTimezone()}`;

        // Object with parameters for the planConnection query
        const queryParams: PlanConnectionParams = {
            pointALat: sectionInfo.pointA.lat,
            pointALng: sectionInfo.pointA.lng,
            pointBLat: sectionInfo.pointB.lat,
            pointBLng: sectionInfo.pointB.lng,
            transitOnly,
            directOnly,
            transitModes,
            directModes,
            datetime,
            numOptions: numOptions !== undefined ? numOptions : 0,  // If the number of options isnt set, 0 is interpreted as unlimited by OTP
            walkingSpeed: sectionInfo.preferences.walk.speed,
        }
        
        // Call OTP service with prepared parameters
        const response = await this.otpService.planConnection(queryParams, sectionInfo.datetime.option);
        if (!response)
            return null;

        // Check OTP routing errors
        const errors = response.data.planConnection.routingErrors;
        if (errors.length !== 0) {
            errors.forEach(error => {
                log('error', `Routing error while planing connection with OTP. Error: ${error.description}`);
            });
            return null;
        }

        // Translate the fetched result from OTP to format expected by caller
        return await this.translateTripOptions(response.data.planConnection.edges);
    }

    // Function building a list of object expected by OTP as a paremter from the transit modes allowed in user preferences
    private getAllowedTransitModes(allowedModes: { bus: boolean, trolleybus: boolean, tram: boolean, train: boolean, ferry: boolean }): PlanTransitModePreferenceInput[] | null {
        let transitModes: PlanTransitModePreferenceInput[] = [];

        // Append allowed modes to list
        if (allowedModes.bus) transitModes.push({ mode: "BUS" });
        if (allowedModes.trolleybus) transitModes.push({ mode: "TROLLEYBUS" });
        if (allowedModes.tram) transitModes.push({ mode: "TRAM" });
        if (allowedModes.train) transitModes.push({ mode: "RAIL" });
        if (allowedModes.ferry) transitModes.push({ mode: "FERRY" });

        // No modes allowed by user
        if (transitModes.length === 0)
            return null;

        return transitModes;
    }

    // Function translating the plain OTP response into format expected by the client calling the adapter
    private async translateTripOptions(edges: Edges): Promise<TripSectionOption[]> {

        // Get dates where data is available in the DB for leg shaping, returns false on errors
        const availableDates: { start: string, disabled: string[], end: string } | false = await dbStats.getAvailableDates(true);
        if (!availableDates)
            log('warning', 'Failed to get available dates for leg shaping.');

        // Get all routes of the transport system that have shapes available in the DB for the latest date
        const routesWithShapes = availableDates ? await this.getRoutesWithShapes(availableDates.end) : null;

        // Accumulator for request of trip option translations (will be executed in 'parallel')
        let tripOptionRequests: Promise<TripSectionOption>[] = [];

        // Iterate over all options returned from OTP and create the translate request
        for (const edge of edges)
            tripOptionRequests.push(this.translateTripOption(edge, routesWithShapes));

        // Wait for all request to finish and return the translated trip options
        return await Promise.all(tripOptionRequests);
    };

    // Function translating a single trip option returned from OTP to client format
    private async translateTripOption(edge: { node: Node }, routesWithShapes: RouteWithShapes[] | null): Promise<TripSectionOption> {

        // Accumulator for total distance (sum of leg distances)
        let totalDistance = 0;

        // Accumulator for leg translations request of the trip (will be executed in 'parallel')
        let legRequests: Promise<TripSectionLeg>[] = [];

        // Iterate over all legs returned from OTP
        for (const leg of edge.node.legs) {

            // Accumulate distance of this leg in the total distance of the trip section
            totalDistance += leg.distance;

            // Register request to translate trip leg
            legRequests.push(this.translateTripLeg(leg, routesWithShapes));
        }

        // Once all legs are translated, create the final trip option object
        return {
            duration: edge.node.duration,
            distance: totalDistance,
            startDatetime: new Date(edge.node.start),
            endDatetime: new Date(edge.node.end),
            legs: await Promise.all(legRequests),       // Wait for all leg translations to finish
        };
    }

    // Function translating a single leg of a trip option returned from OTP to client format
    private async translateTripLeg(leg: Leg, routesWithShapes: RouteWithShapes[] | null): Promise<TripSectionLeg> {
        return {
            distance: leg.distance,
            duration: leg.duration,
            points: await this.getLegShape(leg, routesWithShapes),   // Get leg shape from DB or translate google polyline if the shape isnt in the DB
            mode: leg.mode as Mode,
            from: {
                arrivalTime: new Date(leg.from.arrival.scheduledTime),      // Convert dates as strings into actual UTC JS date objects
                departureTime: new Date(leg.from.departure.scheduledTime),
                placeName: leg.from.stop?.name ?? null,
                isTransportStop: leg.from.stop !== null, 
            },
            to: {
                arrivalTime: new Date(leg.to.arrival.scheduledTime),
                departureTime: new Date(leg.to.departure.scheduledTime),
                placeName: leg.to.stop?.name ?? null,
                isTransportStop: leg.to.stop !== null,  
            },
            route: leg.route ? {
                lineId: leg.route.shortName,
                color: leg.route.color,
                textColor: leg.route.textColor,
            } : null
        }
    }

    // Function decoding google polyline to array of lat/lng coordinate object with mapbox package
    private translateGooglePolyline(encoded: string, precision?: number): { lat: number, lng: number }[] {

        // Use mapbox package to get a list of number tuples
        const decoded = polyline.decode(encoded, precision);

        // Convert into list of lat/lng objects
        return decoded.map(tuple => ({
            lat: tuple[0],
            lng: tuple[1],
        }));
    }

    // Function getting the shapeId from the passed in trip and the list of routes with available shapes
    private getShapeId(trip: { stops: { name: string }[] }, routesWithShapes: RouteWithShapes[]): number {

        // Get names of first and last stop of the trip
        const firstTripStop = trip.stops[0]!.name;
        const lastTripStop = trip.stops[trip.stops.length - 1]!.name;

        // Find shapeId for given trip
        for (const route of routesWithShapes) {
            for (const trip of route.trips) {
                if (trip.stops === `${firstTripStop} -> ${lastTripStop}`)
                    return trip.shape_id;
            }
        }

        // The needed trip wasnt found
        return -1;
    }

    // Function getting the exact shape of a leg in the trip option from the postgis database as a list of lat/lng coordinate points
    private async getLegShape(leg: Leg, routesWithShapes: RouteWithShapes[] | null): Promise<{ lat: number, lng: number }[]> {

        // Check needed conditions to get the trip shape from DB
        // Direct modes dont have shape data in DB and the leg needs to have a defined trip with at least two stops
        if (leg.mode === "WALK" || leg.mode === "CAR" || routesWithShapes === null || leg.trip === null || leg.trip.stops.length < 2)
            return this.translateGooglePolyline(leg.legGeometry.points);

        // Get shapeId of trip used for given leg
        const shapeId = this.getShapeId(leg.trip, routesWithShapes);
        if (shapeId === -1)
            return this.translateGooglePolyline(leg.legGeometry.points);

        // Get actual shape from DB by the found shape
        const shape = await dbPostgis.getFullShape(shapeId);
        if (shape.stops === undefined || shape.coords === undefined)
            return this.translateGooglePolyline(leg.legGeometry.points);

        // The found shape has coordinates for the whole trip used for the leg, need only a subsection of the shape for the actual leg
        return this.getSubShape(leg, shape);
    }

    // Get a subsection of 'shape', which is the shape of 'leg'
    private getSubShape(leg: Leg, shape: any): { lat: number, lng: number }[] {

        // Get names of stops where the leg starts and ends
        const legFrom = leg.from.stop!.name;
        const legTo = leg.to.stop!.name;

        // Find start and end indicies of subshape of the trip shape corresponding to the leg
        const legStartIdx = (shape.stops as { stop_name: string }[]).findIndex(stop => stop.stop_name === legFrom);
        const legEndIdx = (shape.stops as { stop_name: string }[]).findIndex(stop => stop.stop_name === legTo);
        if (legStartIdx === -1 || legEndIdx === -1)
            return this.translateGooglePolyline(leg.legGeometry.points);

        // Flatten the shape structure into a 1D list of lat, lng objects 
        let coords: { lat: number, lng: number }[] = [];
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

    // Function querying the database for routes that have shapes available for a given date
    private async getRoutesWithShapes(latestDate: string): Promise<RouteWithShapes[] | null> {
        
        // Check if the request is for todays shapes, which are likely to already be cached
        if (latestDate === timestamp.getTimeStamp(timestamp.getTodayUTC())) {
            const cache = await dbCache.getTodayShapes();
            return cache.data ?? await dbCache.setUpTodayShapes();  // Store in cache if not cached yet
        }
        else {

            // Attempt to get data from cache for day that isnt today
            const cache = await dbCache.setUpValue(`shapes_${latestDate}`, null, null);
            if (cache.data !== null)
                return cache.data;
            
            // Get available routes for the given date
            const routes = await dbStats.getRoutesIdsInInterval(latestDate, latestDate);
            if (routes.length === 0){
                log('warning', 'No routes found in given interval.');
                return null;
            }

            // Get available tripIds for the available routes for the given date
            let tripIds: number[] = [];
            for (const route of routes) {
                const newTripsIds = await dbStats.getTripIdsInInterval(route, latestDate, latestDate);
                tripIds = tripIds.concat(newTripsIds);
            }
            if (tripIds.length === 0) {
                log('warning', 'No trip ids found in routes for given interval.');
                return null;
            }

            // Get trips from the found Ids and their shapes from the DB
            const tripsWithShape = await dbPostgis.getTripsWithUniqueShape(tripIds);
            if (tripsWithShape.length === 0) {
                log('warning', 'No trips found from given tripIds.');
                return null;
            }

            // Store retrieved data in cache
            dbCache.setUpValue(`shapes_${latestDate}`, tripsWithShape, 100);

            return tripsWithShape;
        }
    }
};