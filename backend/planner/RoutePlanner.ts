/*
 * File: RoutePlanner.ts
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

    // Function performing any possible initialization that should be done by the planners that implement this interface
    // May return 'false' in case of errors
    initialize(): Promise<boolean>

    // Get connection options for a trip between two neighbouring trip points with given modes of transport for the given datetime
    getTripSection(sectionInfo: TripSectionInfo, numOptions?: number): Promise<TripSectionOption[] | null> 
};