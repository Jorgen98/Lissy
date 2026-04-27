/*
 * File: ValhallaService.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Class responsible for accessing the Valhalla instance.
 * Simply calls the instance with given parameters and returns JSON with data.
 */

const logService = require('../../../log.js');

import { buildRouteQuery } from "./queryBuilder";
import { RouteQueryParams } from "./types/RouteQueryParams";
import { RouteQueryResponse } from "./types/RouteQueryResponse";

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

export class ValhallaService {

    // Get a route between two points using Valhalla /route endpoint
    async route(params: RouteQueryParams): Promise<RouteQueryResponse | null> {

        if (!process.env.BE_PLANNER_VALHALLA_URL) {
            log('error', "Missing environment variable with Valhalla instance URL");
            return null;
        }

        // Get parametrized query
        const query = buildRouteQuery(params);

        try {

            // Call Valhalla instance at given URL
            const response = await fetch(process.env.BE_PLANNER_VALHALLA_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: query,
            });

            // Return without response.ok check, since Valhalla sends useful internal error messages with non-200 status codes
            return await response.json();
        }
        catch (error) {
            log('error', `Failed to plan connection with Valhalla. Error: ${error}`);
            return null;
        }
    }
};