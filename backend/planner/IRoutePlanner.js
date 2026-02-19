/*
 * File: IRoutePlanner.js
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Interface for external route planners to implement.
 */

const logService = require('../log.js')
const dotenv = require('dotenv');

dotenv.config();

/*
Interface implemented by individual planner adapters
*/
class IRoutePlanner {

    // Get all stops for autocomplete in the trip form and for latitude and longitude values
    getAllStops() {
        logService.write(process.env.BE_PLANNER_MODULE_NAME, 'error', 'getAllStops() not implemented');
    }
};

module.exports = { IRoutePlanner };