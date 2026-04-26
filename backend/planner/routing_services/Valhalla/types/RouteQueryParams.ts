/*
 * File: RouteQueryParams.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type for object containing parameters needed for the Valhalla /route query.
 */

export type RouteQueryParams = {
    pointALat: number,
    pointALng: number,
    pointBLat: number,
    pointBLng: number, 
    costing: "auto" | "multimodal" | "pedestrian",
    datetimeType: 1 | 2,
    datetimeValue: string,
    walkingSpeed: number, 
    walkReluctance: number, 
    useBus: number, 
};