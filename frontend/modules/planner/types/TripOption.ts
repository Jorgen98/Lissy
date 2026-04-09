/*
 * File: TripOption.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about one trip option.
 */

import { Mode } from "./Mode";

// One leg of the connection
export type TripSectionLeg = {
    distance: number,               // Distance in meters
    duration: number,               // Duration in seconds

    // Place where the leg starts
    from: {
        arrivalTime: Date | null,   // Arrival time, might be null if first leg of connection (UTC)
        departureTime: Date,        
        placeName: string | null,   // Name of the place where the leg starts, can be null
        isTransportStop: boolean,   // Whether the point is a transport system stop or not
        isParking: boolean,         // Whether the point is a parking spot 
    },

    // List of coordinates of points giving the shape of the leg on a map
    points: {
        lat: number,
        lng: number,
    }[],

    // Place where the leg ends
    to: {
        arrivalTime: Date,
        departureTime: Date | null,
        placeName: string | null,
        isTransportStop: boolean, 
        isParking: boolean,        
    },
    mode: Mode,     // Mode used for the leg

    // Information about the route the leg uses, may be null for non-transit legs
    route: {
        lineId: string | null, // Identifier of the line (line number, e.g. S2, 232, N91)

        // Colors preferred for use by the agency sharing the GTFS dataset for this route 
        // Must be given as a six-digit hexadecimal string without the leading #
        color: string | null,
        textColor: string | null

        // Internal gtfsId of the route, can be null if GTFS isnt used for example
        gtfsId: string | null,
    } | null

    // Information about the trip the leg uses, may be null for non-transit legs
    trip: {

        // Internal gtfsId of the trip, can be null if GTFS isnt used for example
        gtfsId: string | null
    } | null,
    isTransitLeg: boolean,

    // List of stops used on the leg, null for non-transit legs
    stops: { name: string, zone: string, lat: number, lng: number }[] | null,
};

// One option for a requested trip section between two points
export type TripSectionOption = {
    duration: number,               // Duration in seconds
    distance: number,               // Distance in meters    
    startDatetime: Date,            // Datetime of beginning of the option (UTC)
    endDatetime: Date,              // Datetime of ending of the option (UTC)
    originName: string | null,      // Name of origin point of section
    destinationName: string | null, // Name of destination point of section
    legs: TripSectionLeg[],         // List of legs
    emissions: number | null,       // Emissions in grams of CO2
    cost: number | null,            // Estimated cost in CZK
    numTransfers: number | null,    // Number of transfers in the sections
};

// One trip option built out of sections
export type TripOption = {
    sections: TripSectionOption[]   // List of sections the entire trip is built from
    duration: number,               // Duration in seconds
    distance: number,               // Distance in meters    
    startDatetime: Date,            // Datetime of beginning of the trip option (UTC)
    endDatetime: Date,              // Datetime of ending of the trip option (UTC)
    numTransfers: number,           // Number of transfers in the trip, might not be the same as the sum of transfers in its sections
    emissions: number,              // Emissions in grams of CO2
    cost: number,                   // Estimated cost of trip in CZK
    score: number,
    fastest: boolean,
    cheapest: boolean,
    best: boolean,
    returnTrip: { 
        section: TripSectionOption | null | "not available"
        hasShape: boolean,
    }
    imported: boolean,              // Whether the trip option was imported as a JSON file
    rerouted: boolean,              // Whether the trip option was rerouted (at least one of its legs)
};