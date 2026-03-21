/*
 * File: PlanConnectionResponse.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Expected response type for the planConnection query from OTP build from a few seperate custom types.
 */

import { OTPMode } from "./OTPMode";

// One leg of the found connection
export type Leg = {
    distance: number,               // Distance in meters
    duration: number,               // Duration in seconds

    // Information about point where the leg starts
    from: {
        arrival: {
            scheduledTime: string   // Scheduled time of arrival
        },
        departure: {
            scheduledTime: string,  // Scheduled time of departure
        }

        // The transport system stop where the leg starts, may be null for non-transit legs
        stop: {
            name: string    // GTFS name of the stop
        } | null,
    },

    // Google polyline encoded string representing coordinates of points on the leg
    legGeometry: {
        length: number,
        points: string,
    },
    mode: OTPMode,     // Transport mode used for the leg

    // Information about the route the leg uses, may be null for non-transit legs
    route: {
        shortName: string | null,   // Short name of the route (usually the line number)

        // Colors preferred for use by the agency sharing the GTFS dataset for this route 
        color: string | null,
        textColor: string | null,
        gtfsId: string // GTFS internal trip id
    } | null,

    // Information about point where the leg ends
    to: {
        arrival: {
            scheduledTime: string
        },
        departure: {
            scheduledTime: string,
        }
        stop: {
            name: string
        } | null,
    },

    // Information about the trip used for the leg
    trip: {

        // List of stops on the trip with thier names
        stops: { 
            name: string 
        }[],
        gtfsId: string // GTFS internal trip id
    } | null
}

// One trip Node (one option for the connection)
export type Node = {  
    duration: number,   // Duration in seconds
    start: string,      // Start time of connection
    end: string,        // End time of connection
    legs: Leg[],        // List of legs in the connection (see above)
}

// List of edges (list of options for the connection)
export type Edges = { node: Node }[];

// Actual format of the response to the planConnection query
export type PlanConnectionResponse = {
    data?: {
        planConnection: {
            edges: Edges,
            routingErrors: { description: string }[],   // List of routing errors and their description
        }
    },
    errors?: {
        message: string,
    }[]
};