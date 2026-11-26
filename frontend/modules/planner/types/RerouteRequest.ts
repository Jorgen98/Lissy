/*
 * File: RerouteRequest.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type with information about a requested transit leg reroute.
 */

import { TripDataExtended } from "./TripDataExtended";
import { TripOption } from "./TripOption";

export type RerouteRequest = {
    originalRequest: TripDataExtended, 
    sectionIdx: number, 
    legIdx: number,
    originalTrip: TripOption,
    direction: "previous" | "next",
};