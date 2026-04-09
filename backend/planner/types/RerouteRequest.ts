/*
 * File: RerouteRequest.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type with information about a requested transit leg reroute.
 */

import { TripOption } from "./TripOption";
import { TransportMode } from "../../../frontend/modules/planner/types/TransportMode";

export type RerouteRequest = {
    sectionModes: Record<TransportMode, boolean>[], 
    sectionIdx: number, 
    legIdx: number,
    originalTrip: TripOption,
    direction: "previous" | "next",
};