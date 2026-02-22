/*
 * File: IRoutePlanner.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Interface for external route planners to implement.
 */

import { Stop } from "../../frontend/modules/planner/types/Stop";

/*
Interface implemented by individual planner adapters
*/
export interface RoutePlanner {

    // Get all stops for autocomplete in the trip form and for latitude and longitude values
    getAllStops(): Promise<{ stops: Stop[] } | null>
};