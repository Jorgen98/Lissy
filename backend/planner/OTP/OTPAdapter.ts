/*
 * File: OTPAdapter.ts
 * Author: Adam Vcelar (xvcelaa00) 
 *
 * Translating adapter class for OpenTripPlanner.
 */

const timestamp = require('../../timestamp.js');
const logService = require('../../log.js');

import { OTPService } from "./OTPService";
import { RoutePlanner } from "../RoutePlanner";
import { Stop } from "../../../frontend/modules/planner/types/Stop";
import { TripSectionInfo } from "../types/TripSectionInfo";
import { PlanConnectionParams } from "./types/PlanConnectionParams";
import { PlanDirectMode } from "./types/PlanDirectMode";
import { PlanTransitModePreferenceInput } from "./types/PlanTransitModePreferenceInput";
import { TripSectionOption, TripSectionLeg } from "../types/TripSectionOption";
import { Edges } from "./types/PlanConnectionResponse";
import polyline from '@mapbox/polyline';

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

    // Get all stops for autocomplete in the trip form and for latitude and longitude values from OTP instance and translate
    async getAllStops(): Promise<{ stops: Stop[] } | null> {

        // Call the otp planner service
        const response = await this.otpService.getAllStations();
        if (!response)
            return null;

        // Translate the returned stops to expected form 
        const stops = response.data.stations.map(station => ({
            lat: station.lat,
            lng: station.lon,
            name: station.name
        }));

        return { stops: stops };
    }

    // Get a route between two points using OTPs planConnection function
    // Function translating the inputs to the format needed by OTP and the outputs to the format needed by client
    async getTripSection(sectionInfo: TripSectionInfo, numOptions?: number): Promise<TripSectionOption[] | null>  {

        // Which of the possible transport modes should be used in this sections planning
        // TODO decide what to do with OTPs heavy preference for car transport
        const usePublicTransport = sectionInfo.modes.some(mode => mode === "publicTransport"); 
        const useWalk = sectionInfo.modes.some(mode => mode === "walk");
        const useCar = sectionInfo.modes.some(mode => mode === "car");

        // Limit to only transit or direct planning based on selected modes
        const transitOnly = usePublicTransport && !useCar && !useWalk;
        const directOnly = !usePublicTransport;

        // Create list of OTP valid objects for public transport modes
        const transitModes: PlanTransitModePreferenceInput[] | null = usePublicTransport ? [
            { mode: "TRAM" }, 
            { mode: "BUS" },
            { mode: "RAIL" },
            { mode: "TROLLEYBUS" },
        ] : null;

        // TODO decide what to do when both car and walk are selected for the section, since OTP does not allow this
        // For now just use car
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
            numOptions: numOptions !== undefined ? numOptions : null,
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

        return this.translateTripOptions(response.data.planConnection.edges);
    }

    // Function translating the plain OTP response into format expected by the client calling the adapter
    private translateTripOptions(edges: Edges): TripSectionOption[] {
        return edges.map(edge => {

            // Accumulator for total distance of the entire section, since OTP doesnt provide this
            let totalDistance = 0;

            const legs: TripSectionLeg[] = edge.node.legs.map(leg => {
                
                // Add distance of the leg to the total distance
                totalDistance += leg.distance;

                return {
                    distance: leg.distance,
                    duration: leg.duration,
                    points: this.translateGooglePolyline(leg.legGeometry.points),   // Decode google polyline to array of lat/lng coordinate object
                    mode: leg.mode,
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
                };
            });

            return {
                duration: edge.node.duration,
                distance: totalDistance,
                startDatetime: new Date(edge.node.start),
                endDatetime: new Date(edge.node.end),
                legs,
            }
        });
    };

    // Function decoding google polyline to array of lat/lng coordinate object with mapbox package
    private translateGooglePolyline(encoded: string, precision?: number): { lat: number, lng: number }[] {

        // Use mapbox package to get a list of number pairs
        const decoded = polyline.decode(encoded, precision);

        // Convert into list of lat/lng objects
        return decoded.map(tuple => ({
            lat: tuple[0],
            lng: tuple[1],
        }));
    }
};