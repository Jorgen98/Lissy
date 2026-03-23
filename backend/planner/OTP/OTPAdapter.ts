/*
 * File: OTPAdapter.ts
 * Author: Adam Vcelar (xvcelaa00) 
 *
 * Translating adapter class for OpenTripPlanner.
 */

const logService = require('../../log.js');

import { OTPService } from "./OTPService";
import { RoutePlanner } from "../RoutePlanner";
import { TripSectionInfo } from "../types/TripSectionInfo";
import { PlanConnectionParams } from "./types/PlanConnectionParams";
import { PlanDirectMode } from "./types/PlanDirectMode";
import { PlanTransitModePreferenceInput } from "./types/PlanTransitModePreferenceInput";
import { TripSectionOption, TripSectionLeg } from "../types/TripOption";
import { Edges, Leg, Node, RoutingErrorCode } from "./types/PlanConnectionResponse";
import polyline from '@mapbox/polyline';
import { Mode } from "../types/Mode";
import { LatLng } from "../types/LatLng";
import { OTP_MAX_WINDOW_PAGING_ATTEMPTS } from "../utils/coefficients";

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
            datetime: sectionInfo.datetime.datetime,
            numOptions: numOptions !== undefined ? numOptions : 0,  // If the number of options isnt set, 0 is interpreted as unlimited by OTP
            walkingSpeed: sectionInfo.preferences.walk.speed,
            cursor: null,
        }
        
        // Query OTP and use the built-in paging mechanism when necessary
        const edges = await this.planConnectionWithPaging(queryParams, sectionInfo);
        if (!edges)
            return null;

        // Translate the fetched result from OTP to format expected by caller
        return await this.translateTripOptions(edges);
    }

    // Function querying OTP (possibly multiple times with paging) to find trip section options
    private async planConnectionWithPaging(params: PlanConnectionParams, sectionInfo: TripSectionInfo): Promise<Edges | null> {

        let nextPageAttempts = 0;
        let shouldAttemptPaging = true;
        while (shouldAttemptPaging) {

            // Call OTP service with prepared parameters
            const response = await this.otpService.planConnection(params, sectionInfo.datetime.option);
            if (!response)
                return null;

            // Check OTP specific errors
            if (!response.data) {
                if (response.errors) {
                    response.errors.forEach(error => {
                        log('error', `Error while planing connection with OTP. Error: ${error.message}`);
                    });
                }
                else
                    log('error', `Error while planing connection with OTP. Unknown error`);
                
                return null;
            }

            // Check OTP routing errors and store the code of the first one
            const errors = response.data.planConnection.routingErrors;
            let routingErrorCode: RoutingErrorCode | null = null;
            if (errors.length !== 0) {
                const error = errors[0]!;
                routingErrorCode = error.code;
                log('info', `Routing error while planing connection with OTP. Error: ${error.description}`);
            }

            // If at least one option is found in the search window, return the options
            const edges = response.data.planConnection.edges;
            if (edges.length !== 0)
                return edges;

            // Decide if next page should be fetched with following search window, based on attempt, page availiability and routing error
            shouldAttemptPaging = 
                response.data.planConnection.pageInfo.hasNextPage 
                && nextPageAttempts++ < OTP_MAX_WINDOW_PAGING_ATTEMPTS 
                && routingErrorCode === "NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW";
            params.cursor = response.data.planConnection.pageInfo.endCursor;

            if (shouldAttemptPaging) log('info', `Attempting routing with OTP in next search window...`);
        }

        return null;    // Paging no longer possible and no trip options found
    }

    // Function performing any initializations for the OTPAdapter, empty implementation
    public async initialize(): Promise<boolean> {
        return true;
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

        // Accumulator for translated trip options
        let tripOptionRequests: TripSectionOption[] = [];

        // Iterate over all options returned from OTP and wait for the translation
        for (const edge of edges)
            tripOptionRequests.push(await this.translateTripOption(edge));

        return tripOptionRequests;
    };

    // Function translating a single trip option returned from OTP to client format
    private async translateTripOption(edge: { node: Node }): Promise<TripSectionOption> {

        // Accumulator for total distance (sum of leg distances)
        let totalDistance = 0;

        // Accumulator for leg translations request of the trip (will be executed in 'parallel')
        let legRequests: Promise<TripSectionLeg>[] = [];

        // Iterate over all legs returned from OTP
        for (const leg of edge.node.legs) {

            // Accumulate distance of this leg in the total distance of the trip section
            totalDistance += leg.distance;

            // Register request to translate trip leg
            legRequests.push(this.translateTripLeg(leg));
        }

        // Once all legs are translated, create the final trip option object
        return {
            duration: edge.node.duration,
            distance: totalDistance,
            startDatetime: new Date(edge.node.start),
            endDatetime: new Date(edge.node.end),
            legs: await Promise.all(legRequests),       // Wait for all leg translations to finish

            // Initialize empty names for section origin and destination points
            originName: null,
            destinationName: null,
        };
    }

    // Function translating a single leg of a trip option returned from OTP to client format
    private async translateTripLeg(leg: Leg): Promise<TripSectionLeg> {
        return {
            distance: leg.distance,
            duration: leg.duration,
            points: this.translateGooglePolyline(leg.legGeometry.points),   
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
                gtfsId: leg.route.gtfsId,
            } : null,
            trip: leg.trip ? {
                gtfsId: leg.trip.gtfsId,
            } : null,
        }
    }

    // Function decoding google polyline to array of lat/lng coordinate object with mapbox package
    private translateGooglePolyline(encoded: string, precision?: number): LatLng[] {

        // Use mapbox package to get a list of number tuples
        const decoded = polyline.decode(encoded, precision);

        // Convert into list of lat/lng objects
        return decoded.map(tuple => ({
            lat: tuple[0],
            lng: tuple[1],
        }));
    }
};