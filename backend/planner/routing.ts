/*
 * File: routing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Function for routing and building a response to a trip request using the planner adapter.
 */

import { TransportMode } from "../../frontend/modules/planner/types/TransportMode";
import { RoutePlanner } from "./RoutePlanner";
import { TripRequest } from "./types/TripRequest";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { TripSectionOption } from "./types/TripSectionOption";

export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripSectionOption[] | null> {

    // Specific case where there are only two trip points in the plan
    if (request.points.length === 2) {

        // Convert the object containing which modes are used for the entire trip into an array of selected modes as strings
        const globalModes = (Object.keys(request.modes.global) as TransportMode[])
            .filter(mode => request.modes.global[mode]);

        // Create object with internal representation of information needed for a section of the trip between two points
        const sectionInfo: TripSectionInfo = {
            pointA: request.points[0]!,
            pointB: request.points[1]!,
            modes: globalModes,
            datetime: {
                option: request.datetime.datetimeOption,
                date: request.datetime.tripDate,
                time: request.datetime.tripTime   
            }
        };

        // Send the internal representation to the selected adapter
        // The adapter translates the internal TripSectionInfo object into the representation its corresponding service needs
        // TODO decide on adequate maximum number of options for the section (3 for now)
        return await planner.getTripSection(sectionInfo, 3);
    }

    // TODO handle trip with midpoints
    return null;
}