/*
 * File: OTPService.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Class responsible for accessing the OTP instance.
 * Simply calls the instance with given parameters, checks errors and returns plain response JSON.
 */

const logService = require('../../log.js');

import { getAllStationsQuery, getPlanConnectionQuery } from "./gqlQueries";
import { OTPStationsResponse } from "./types/StationsResponse";
import { PlanConnectionParams } from "./types/PlanConnectionParams";
import { PlanConnectionResponse } from "./types/PlanConnectionResponse";

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

/*
Class calling the local running OpenTripPlanner instance
*/
export class OTPService {

    // Get all stations for autocomplete in the trip form and for latitude and longitude values from OTP instance
    // Using stations, because a station is always unique, while there are usually multiple stops with duplicated names
    async getAllStations(): Promise<OTPStationsResponse | null> {
        try {

            // Get all stations from OTP instance at given URL
            const response = await fetch(process.env.BE_PLANNER_OTP_URL!, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    query: getAllStationsQuery(), 
                }),
            });

            // Check HTTP status code
            if (!response.ok) {
                log('error', `Failed to fetch stops from OTP. HTTP status: ${response.status}`);
                return null;
            }

            return response.json();
        }
        catch (error) {
            log('error', `Failed to fetch stops from OTP. Error: ${error}`);
            return null;
        }
    }

    // Get a route between two points using OTPs planConnection function
    async planConnection(variables: PlanConnectionParams, datetimeOption: "arrival" | "departure"): Promise<PlanConnectionResponse | null> {

        // Get parametrized planConnection query
        const query = getPlanConnectionQuery(datetimeOption);

        try {

            // Call OTP instance at given URL with given variables
            const response = await fetch(process.env.BE_PLANNER_OTP_URL!, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, variables })
            });

            // Check HTTP status code
            if (!response.ok) {
                log('error', `Failed to plan connection with OTP. HTTP status: ${response.status}`);
                return null;
            }

            return await response.json();
        }
        catch (error) {
            log('error', `Failed to plan connection with OTP. Error: ${error}`);
            return null;
        }
    }
};  