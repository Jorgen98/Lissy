/*
 * File: queryBuilder.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * File with query builder function for Valhalla.
 */

import { RouteQueryParams } from "./types/RouteQueryParams";

// Function adding passed in parameters to a query template and returning a serialized string 
export function buildRouteQuery(params: RouteQueryParams): string {

    // Build and return parametrized query serialized
    return JSON.stringify({
        locations: [
            { lat: params.pointALat, lon: params.pointALng, type: "break" },
            { lat: params.pointBLat, lon: params.pointBLng, type: "break" },
        ],
        costing: params.costing,
        costing_options: {
            pedestrian: {
                walking_speed: params.walkingSpeed,
                mode_factor: params.walkReluctance,
            },
            transit: {
                use_bus: params.useBus,
            }
        },
        directions_type: "maneuvers",
        date_time: {
            type: params.datetimeType,
            value: params.datetimeValue,
        }
    });
}