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
import { Edges, Leg, Node, PlanConnectionResponse, RoutingErrorCode } from "./types/PlanConnectionResponse";
import { Mode } from "../types/Mode";
import { OTP_MAX_WINDOW_PAGING_ATTEMPTS } from "../utils/systemConstants";
import { translateGooglePolyline } from "../shaping";

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
        const usePublicTransport = sectionInfo.modes.publicTransport;
        const useWalk = sectionInfo.modes.walk;
        const useCar = sectionInfo.modes.car;

        // Limit to only transit or direct planning based on selected modes
        const transitOnly = usePublicTransport && !useCar && !useWalk;
        const directOnly = !usePublicTransport;

        // Create list of OTP valid objects for public transport modes based on user preferences
        const transitModes = usePublicTransport ? this.getAllowedTransitModes(sectionInfo.preferences.publicTransport.allowedModes) : null;

        // Select one direct mode, since OTP only allows one
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
            walkingSpeed: sectionInfo.preferences.walk.avgSpeed,
            afterCursor: null,
            beforeCursor: null,
        }
        
        // Query OTP and use the built-in paging mechanism when necessary
        const edges = await this.planConnectionWithPaging(queryParams, sectionInfo);
        if (!edges)
            return null;

        // Translate the fetched result from OTP to format expected by caller
        return edges.map(edge => this.translateTripOption(edge));
    }

    // Function querying OTP (possibly multiple times with paging) to find trip section options
    private async planConnectionWithPaging(params: PlanConnectionParams, sectionInfo: TripSectionInfo): Promise<Edges | null> {

        let nextPageAttempts = 0;
        while (true) {

            // Call OTP service with prepared parameters
            const response = await this.otpService.planConnection(params, sectionInfo.datetime.option);
            if (!response)
                return null;

            // Check OTP specific errors
            if (!response.data || !response.data.planConnection) {
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
            const datetimeOption = sectionInfo.datetime.option;
            params.afterCursor = datetimeOption === "departure" ? response.data.planConnection.pageInfo.endCursor : null;
            params.beforeCursor = datetimeOption === "arrival" ? response.data.planConnection.pageInfo.startCursor : null;
            if (this.shouldAttemptPaging(response, routingErrorCode, nextPageAttempts++, datetimeOption))
                log('info', `Attempting routing with OTP in next search window...`);
            else
                return null;
        }
    }

    // Function deciding if the paging loop should continue
    private shouldAttemptPaging(
        response: PlanConnectionResponse, 
        errorCode: RoutingErrorCode | null, 
        attempts: number,
        datetimeOption: "arrival" | "departure"
    ): boolean {

        if (attempts >= OTP_MAX_WINDOW_PAGING_ATTEMPTS)
            return false;

        if (errorCode !== "NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW" && errorCode !== null)
            return false;

        if (datetimeOption === "departure")
            return response.data!.planConnection.pageInfo.hasNextPage;
        else 
            return response.data!.planConnection.pageInfo.hasPreviousPage;
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

    // Function translating a single trip option returned from OTP to client format
    private translateTripOption(edge: { node: Node }): TripSectionOption {

        // Accumulator for total distance (sum of leg distances)
        let totalDistance = 0;

        // Accumulator for translated legs
        const legs: TripSectionLeg[] = [];

        // Iterate over all legs returned from OTP
        for (const leg of edge.node.legs) {

            // Accumulate distance of this leg in the total distance of the trip section
            totalDistance += leg.distance;

            // Translate the leg
            legs.push(this.translateTripLeg(leg));
        }

        // Once all legs are translated, create the final trip option object
        return {
            duration: edge.node.duration,
            distance: totalDistance,
            startDatetime: new Date(edge.node.start),
            endDatetime: new Date(edge.node.end),
            legs,

            // Initialize empty names for section origin and destination points
            originName: null,
            destinationName: null,

            // Emissions not provided with OTP, will be calculated later
            emissions: null,

            // Cost not provided with IDS JMK GTFS data, calculated later
            cost: null,

            // Not provided in OTP, calculated later
            numTransfers: null,

            // Calculated later
            score: null,
        };
    }

    // Function getting a list of unique zones used on a returned leg
    private getZonesUsedOnLeg(leg: Leg): string[] | null {

        // Get names of the trips where the legs starts and ends
        const fromName = leg.from.stop?.name;
        const toName = leg.to.stop?.name;

        // Return no zones when there are none used
        if (leg.trip === null || fromName === undefined || toName === undefined || !leg.transitLeg)
            return null;

        // Set with unique zones for automatic uniqueness
        const uniqueZones = new Set<string>();

        // Iterate through stops of the trip the leg uses, only start accumulating the zones when the leg actually starts on the trip
        let countZones = false;
        for (const stop of leg.trip.stops) {

            // Start accumulating only after countZones is true
            if (!countZones) {
                if (stop.name === fromName)
                    countZones = true;
                else 
                    continue;
            }

            // Add zone ids to the set
            uniqueZones.add(stop.zoneId);

            // Finish when the last stop of the leg is reached on the trip
            if (stop.name === toName)
                break;
        }

        // Convert to array
        return Array.from(uniqueZones);
    }

    // Function translating a single leg of a trip option returned from OTP to client format
    private translateTripLeg(leg: Leg): TripSectionLeg {
        return {
            distance: leg.distance,
            duration: leg.duration,
            points: translateGooglePolyline(leg.legGeometry.points),   
            mode: leg.mode as Mode,
            from: {
                arrivalTime: new Date(leg.from.arrival.scheduledTime),      // Convert dates as strings into actual UTC JS date objects
                departureTime: new Date(leg.from.departure.scheduledTime),
                placeName: leg.from.stop?.name ?? null,
                isTransportStop: leg.from.stop !== null, 
                isParking: false,
            },
            to: {
                arrivalTime: new Date(leg.to.arrival.scheduledTime),
                departureTime: new Date(leg.to.departure.scheduledTime),
                placeName: leg.to.stop?.name ?? null,
                isTransportStop: leg.to.stop !== null,  
                isParking: false,
                latLng: { lat: leg.to.lat, lng: leg.to.lon }
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
            zones: this.getZonesUsedOnLeg(leg),
            isTransitLeg: leg.transitLeg,
        }
    }
};