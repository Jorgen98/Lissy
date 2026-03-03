/*
 * File: IRoutePlanner.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Interface for external route planners to implement.
 */

import { TripSectionInfo } from "./types/TripSectionInfo";
import { TripSectionOption } from "./types/TripSectionOption";

/*
Interface implemented by individual planner adapters
*/
export interface RoutePlanner {

    // Get connection options for a trip between two neighbouring trip points with given modes of transport for the given datetime
    getTripSection(sectionInfo: TripSectionInfo, numOptions?: number): Promise<TripSectionOption[] | null> 
};