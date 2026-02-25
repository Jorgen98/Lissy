/*
 * File: TripSectionOption.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about one connection option between two points.
 */

import { Mode } from "./Mode";

// One leg of the connection
export type TripSectionLeg = {
    distance: number,               // Distance in meters
    duration: number,               // Duration in minutes

    // Place where the leg starts
    from: {
        arrivalTime: Date | null,   // Arrival time, might be null if first leg of connection (UTC)
        departureTime: Date,        
        placeName: string | null,   // Name of the place where the leg starts, can be null
        isTransportStop: boolean,   // Whether the point is a transport system stop or not
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
    },
    mode: Mode,     // Mode used for the leg

    // Information about the route the leg uses, may be null for non-transit legs
    route: {
        lineId: string | null, // Identifier of the line (line number, e.g. S2, 232, N91)

        // Colors preferred for use by the agency sharing the GTFS dataset for this route 
        color: string | null,
        textColor: string | null
    } | null
};

// One option for a requested trip section
export type TripSectionOption = {
    duration: number,       // Duration in minutes
    distance: number,       // Distance in meters    
    startDatetime: Date,    // Datetime of beginning of the option (UTC)
    endDatetime: Date,      // Datetime of ending of the option (UTC)
    legs: TripSectionLeg[], // List of legs
};