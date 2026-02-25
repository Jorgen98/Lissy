/*
 * File: IRoutePlanner.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Interface for external route planners to implement.
 */

import { Stop } from "../../frontend/modules/planner/types/Stop";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { TripSectionOption } from "./types/TripSectionOption";

/*
Interface implemented by individual planner adapters
*/
export interface RoutePlanner {

    // Get all stops for autocomplete in the trip form and for latitude and longitude values
    getAllStops(): Promise<{ stops: Stop[] } | null>

    // Get connection options for a trip between two neighbouring trip points with given modes of transport for the given datetime
    getTripSection(sectionInfo: TripSectionInfo, numOptions?: number): Promise<TripSectionOption[] | null> 
};