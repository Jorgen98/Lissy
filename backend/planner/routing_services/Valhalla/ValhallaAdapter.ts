/*
 * File: ValhallaAdapter.ts
 * Author: Adam Vcelar (xvcelaa00) 
 *
 * Translating adapter class for Valhalla.
 */

const logService = require('../../../log.js');

import { RoutePlanner } from "../RoutePlanner";
import { ValhallaService } from "./ValhallaService";
import { TripSectionInfo } from "../../types/TripSectionInfo";
import { Stop, TripSectionLeg, TripSectionOption } from "../../types/TripOption";
import { RouteQueryParams } from "./types/RouteQueryParams";
import { Leg, Maneuver, TransitStop, TravelType, Trip } from "./types/RouteQueryResponse";
import { translateGooglePolyline } from "../../shaping";
import { LatLng } from "../../types/LatLng";
import { Mode } from "../../types/Mode";

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

/* 
Adapter for Valhalla instance
*/
export class ValhallaAdapter implements RoutePlanner {

    constructor(
        private valhallaService: ValhallaService
    ) { }

    // Get a route between two points using Valhalla /route endpoint
    // Function translating the inputs to the format needed by Valhalla and the outputs to the format needed by client
    // Returns a list of found trip options from the request
    public async getTripSection(sectionInfo: TripSectionInfo, numOptions?: number): Promise<TripSectionOption[] | null> {
        
        // Convert input UTC datetime to local timezone datetime
        const datetime = new Date(sectionInfo.datetime.datetime);
        const datetimeValue = new Date(datetime.getTime() - datetime.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16); 

        // Translate parameters for the query
        const queryParams: RouteQueryParams = {
            pointALat: sectionInfo.pointA.lat,
            pointALng: sectionInfo.pointA.lng,
            pointBLat: sectionInfo.pointB.lat,
            pointBLng: sectionInfo.pointB.lng,
            useBus: sectionInfo.preferences.publicTransport.allowedModes.bus ? 1.0 : 0.0,
            datetimeType: sectionInfo.datetime.option === "departure" ? 1 : 2,
            walkReluctance: sectionInfo.isReroute ? 10.0 : 1.5,
            costing: sectionInfo.modes.car ? "auto" : (sectionInfo.modes.publicTransport ? "multimodal" : "pedestrian"),
            walkingSpeed: sectionInfo.preferences.walk.avgSpeed * 3.6,  // Convert to km/h
            datetimeValue,
        };

        // Call Valhalla service with prepared parameters
        const response = await this.valhallaService.route(queryParams);
        if (!response)
            return null;

        // Check status and error code fields
        if (response.error_code) {
            log('error', `Error while planing connection with Valhalla. Error: ${response.error}`);
            return null;
        }

        // Translate the trip into the format expected by caller
        return this.translateTrip(response.trip!);
    }

    // Function translating the root valhalla trip object into a section
    private translateTrip(trip: Trip): TripSectionOption[] {

        // Get start and end datetimes from the propagated location objects
        const startDatetime = new Date(trip.locations[0]!.date_time);
        const endDatetime = new Date(trip.locations[1]!.date_time);

        return [{
            startDatetime,
            endDatetime,
            legs: this.buildLegs(trip.legs[0]!, startDatetime),     // Translate into expected leg objects
            distance: trip.summary.length * 1000,                   // Convert to meters
            duration: trip.summary.time,

            // Calculated/added later
            destinationName: null,
            cost: null,
            emissions: null,
            numTransfers: null,
            score: null,
            originName: null,
        }];
    }

    // Function taking the Valhalla leg (a part of the trip between two given locations) 
    // and transliting it into a list of client legs (actual legs, one for each used connection)
    private buildLegs(full: Leg, tripStartTime: Date): TripSectionLeg[] {

        // Accumulator for the built legs
        const legs: TripSectionLeg[] = [];

        // Decode the google polyline into a list of latLng objects
        const fullShape = translateGooglePolyline(full.shape, 6);

        // Index of the first maneuver in the group of maneuvers, which are in a single client leg
        let firstManeuverIdx = 0;

        // The first leg starts at the start time of the trip
        let currentTime = tripStartTime;

        // Iterate over all the maneuvers in the leg
        for (let i = 0; i < full.maneuvers.length; i++) {

            // Flag if this is the very last maneuver
            const isLastManeuver = i === full.maneuvers.length - 1;

            // Check if the transport mode changes in the next maneuver (end of currently built leg)
            const modeChanged = !isLastManeuver && full.maneuvers[i]!.travel_mode !== full.maneuvers[i + 1]!.travel_mode;

            // If the mode has changed or this is the last maneuver, build one client leg 
            if (modeChanged || isLastManeuver) {

                // Get a slice of the maneuvers from the index of the first one until the one where the mode changes (exclusive)
                const groupManeuvers = full.maneuvers.slice(firstManeuverIdx, i + 1);

                // Get indices for a slice of the full leg shape for this group of maneuvers
                const shapeStartIdx = full.maneuvers[firstManeuverIdx]!.begin_shape_index;
                const shapeEndIdx = full.maneuvers[i]!.end_shape_index + 1;

                // Translate the group of maneuvers into a single leg
                const newLeg = this.translateLeg(
                    groupManeuvers,
                    fullShape.slice(shapeStartIdx, shapeEndIdx),
                    currentTime
                ); 
                legs.push(newLeg);
    

                // If the first maneuver in the next group is a transit maneuver 
                if (full.maneuvers[i + 1]?.transit_info) {

                    // Update the datetime for the start of the next group to the departure of the next maneuver
                    const nextDeparture = full.maneuvers[i + 1]!.transit_info!.transit_stops[0]!.departure_date_time;
                    currentTime = new Date(nextDeparture);
                } else 
                    currentTime = newLeg.to.arrivalTime; // Otherwise just the arrival time of the current group

                // Update index into the first maneuver of the next group
                firstManeuverIdx = i + 1;
            }
        }

        return legs;
    }

    // Function translating a maneuver group into a client leg
    private translateLeg(maneuvers: Maneuver[], shape: LatLng[], legStartTime: Date): TripSectionLeg {

        // Whether this leg is a transit leg
        const isTransitLeg = maneuvers[0]!.transit_info !== undefined; 

        // Calculate total duration of the leg from the maneuver group durations
        const duration = maneuvers.reduce((sum, maneuver) => sum + maneuver.time, 0); 

        return {
            distance: maneuvers.reduce((sum, maneuver) => sum + maneuver.length, 0) * 1000, // Convert to meters
            duration,
            isTransitLeg,
            from: {
                arrivalTime: null,

                // Use first stop departure time for a transit leg, otherwise the passed in start of the leg
                departureTime: isTransitLeg ? new Date(maneuvers[0]!.transit_info!.transit_stops[0]!.departure_date_time!) : legStartTime,
                isParking: false,               // May be set to true later
                isTransportStop: isTransitLeg,
                latLng: shape[0]!,              
                placeName: maneuvers[0]?.transit_info?.transit_stops[0]?.name ?? null,
            },
            mode: this.translateMode(maneuvers[0]!.travel_type), // Translate the Valhalla mode 
            points: shape,
            route: isTransitLeg ? {

                // Convert numeric represenation of color to hex string
                color: `${maneuvers[0]!.transit_info!.color.toString(16).padStart(6, '0')}`,
                textColor: `${maneuvers[0]!.transit_info!.text_color.toString(16).padStart(6, '0')}`,
                lineId: maneuvers[0]!.transit_info!.short_name,
                gtfsId: null,   // Not available in Valhalla
            } : null,

            // Translate stops for transit legs
            stops: isTransitLeg ? maneuvers[0]!.transit_info!.transit_stops.map(stop => this.translateStop(stop)) : null,
            to: {

                // Use last stop arrival time for a transit leg, otherwise the calculated end of the leg
                arrivalTime: isTransitLeg 
                    ? new Date(maneuvers[0]!.transit_info!.transit_stops[maneuvers[0]!.transit_info!.transit_stops.length - 1]!.arrival_date_time!)
                    : new Date(legStartTime.getTime() + duration * 1000),
                departureTime: null,
                isParking: false,
                isTransportStop: isTransitLeg,
                latLng: shape[shape.length - 1]!,
                placeName: isTransitLeg ? 
                    maneuvers[maneuvers.length - 1]?.transit_info?.transit_stops[maneuvers[maneuvers.length - 1]!.transit_info!.transit_stops.length - 1]!.name! : null,
            },

            trip: null,     // Not available in Valhalla
            zones: null,    // Not available in Valhalla
        };
    }

    // Function translating a Valhalla stop into a client expected stop object
    private translateStop(valhallaStop: TransitStop): Stop {
        return {
            lat: valhallaStop.lat,
            lng: valhallaStop.lon,
            name: valhallaStop.name,
            zone: null,                 // Not available in Valhalla
        };
    } 

    // Function translating string-like Valhalla modes into client expected modes
    private translateMode(type: TravelType): Mode {
        switch(type) {
            case "bus":
                return "BUS";
            case "car":
                return "CAR";
            case "ferry":
                return "FERRY";
            case "foot":
                return "WALK";
            case "metro":
                return "SUBWAY";
            case "rail":
                return "RAIL";
            case "tram":
                return "TRAM";
            default: 
                log("warning", `Unexpected mode ${type} in Valhalla adapter`);
                return "BUS";
        }
    }

    // Function performing any initializations for the ValhallaAdapter, empty implementation
    public async initialize(): Promise<boolean> {
        return true;
    }
};