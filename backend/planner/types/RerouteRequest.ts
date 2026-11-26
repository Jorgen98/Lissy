/*
 * File: RerouteRequest.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type with information about a requested transit leg reroute.
 */

import { TripOption } from "./TripOption";
import { TripRequest } from "./TripRequest";

export type RerouteRequest = {
    originalRequest: TripRequest, 
    sectionIdx: number, 
    legIdx: number,
    originalTrip: TripOption,
    direction: "previous" | "next",
};