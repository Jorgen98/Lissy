/*
 * File: routing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Function for routing and building a response to a trip request using the planner adapter.
 */

import { RoutePlanner } from "./RoutePlanner";
import { TripRequest } from "./types/TripRequest";

export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<any | null> {
    // Call 'planner' for each trip section given in 'request'
    // Build sections into full trip
        // Or number of possible trips when the number of midpoints is low

    // Return trip(s) or null if some error occurs
}