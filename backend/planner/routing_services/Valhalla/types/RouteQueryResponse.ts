/*
 * File: RouteQueryResponse.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Expected response type for the /route query from Valhalla built from a few seperate custom types.
 */

// Possible used transport modes
export type TravelType = "car" | "tram" | "metro" | "rail" | "bus" | "ferry" | "foot";

// One stop on a transit maneuver
export type TransitStop = {
    name: string,                   // The stops name
    arrival_date_time: string,      // Arrival time at the stop
    departure_date_time: string,    // Departure time from the stop

    // Coordinates
    lat: number,
    lon: number,
};

// One maneuver in a trip leg
export type Maneuver = {
    time: number,                       // Duration of the maneuver in seconds
    length: number,                     // Distance of the manuever in kilometers 

    // Indicies into decoded shape array (see Leg.shape below) describing the maneuver shape
    begin_shape_index: number,      
    end_shape_index: number,

    // Information about a transit maneuver, undefined if not a transit maneuver
    transit_info: {
        short_name: string,             // Route name
        color: number,                  // Route color
        text_color: number,             // Route text color
        transit_stops: TransitStop[],   // List of stops used on the maneuver
    } | undefined, 
    travel_mode: "drive" | "pedestrian" | "transit",    // Transport mode category used on the maneuver
    travel_type: TravelType,                            // Specific transport mode used on the maneuver
};

// A single trip leg (between two locations given in the request)
export type Leg = {
    summary: {
        time: number,       // Duration in seconds 
        length: number,     // Distance in kilometers
    }
    shape: string,          // Google polyline string describing the shape of the leg
    maneuvers: Maneuver[],  // List of maneuvers the leg is built out of
};

// Location propagated from the request back into the response
type Location = {
    date_time: string,  // Datetime at the location
};

// Root trip object in the response
export type Trip = {

    // HTTP status and message
    status: number, 
    status_message: string, 
    summary: {
        time: number,   // Full trip duration
        length: number, // Full trip distance    
    },
    legs: Leg[],            // List of legs on the trip 
    locations: Location[],  // List of locations
};

// Root response object
export type RouteQueryResponse = {
    trip?: Trip,            // The single trip object describing the found trip

    // Error information
    error_code?: number,
    error?: string,
};