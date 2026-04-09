/*
 * File: RerouteRequest.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type with information about a requested transit leg reroute.
 */

import { TransportMode } from "./TransportMode";
import { TripOption } from "./TripOption";

export type RerouteRequest = {
    sectionModes: Record<TransportMode, boolean>[], 
    sectionIdx: number, 
    legIdx: number,
    originalTrip: TripOption,
    direction: "previous" | "next",
};