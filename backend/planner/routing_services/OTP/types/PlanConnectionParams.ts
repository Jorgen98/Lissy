/*
 * File: PlanConnectionParams.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type for object containing parameters needed for the OTP planConnection query.
 */

import { PlanDirectMode } from "./PlanDirectMode";
import { PlanTransitModePreferenceInput } from "./PlanTransitModePreferenceInput";

export type PlanConnectionParams = {
    pointALat: number,
    pointALng: number,
    pointBLat: number,
    pointBLng: number, 
    datetime: string, 
    directOnly: boolean,
    transitOnly: boolean,
    directModes: PlanDirectMode[] | null,
    transitModes: PlanTransitModePreferenceInput[] | null,
    numOptions: number | null,
    walkingSpeed: number,
    afterCursor: string | null,   
    beforeCursor: string | null,
    walkReluctance: number | null,
};