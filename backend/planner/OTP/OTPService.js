/*
 * File: OTPService.js
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Class responsible for accessing the OTP instance.
 */

const logService = require('../../log.js');
const queries = require('./gqlQueries.js');

// Function for logging 
function log(type, msg) {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

/*
Class calling the local running OpenTripPlanner instance
*/
class OTPService {

    // Get all stations for autocomplete in the trip form and for latitude and longitude values from OTP instance
    // Using stations, because a station is always unique, while there are usually multiple stops with duplicated names
    async getAllStations() {
        try {

            // Get all stations from OTP instance at given URL
            const response = await fetch(process.env.BE_PLANNER_OTP_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    query: queries.allStationsQuery, 
                }),
            });

            // Check HTTP status code
            if (!response.ok) {
                log('error', `Failed to fetch stops from OTP. HTTP status: ${response.status}`);
                return null;
            }

            return await response.json();
        }
        catch (error) {
            log('error', `Failed to fetch stops from OTP. Error: ${error}`);
            return null;
        }
    }
};  

module.exports = { OTPService };