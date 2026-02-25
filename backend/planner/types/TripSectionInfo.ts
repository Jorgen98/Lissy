/*
 * File: TripSectionInfo.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about a single section of a trip between two neighbouring points from the trip request.
 */

import { TransportMode } from "../../../frontend/modules/planner/types/TransportMode"

export type TripSectionInfo =  {
    pointA: { lat: number, lng: number },   // Coordinates of the first point
    pointB: { lat: number, lng: number },   // Coordinates of the second point
    modes: TransportMode[],                 // Requested transport modes between the two points
    datetime: {                             // Earliest departure/latest arrival date and time
        date: string,
        time: string,
        option: "departure" | "arrival"
    }
}