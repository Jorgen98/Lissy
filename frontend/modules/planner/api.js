const env = require('./config.json');
const logService = require('../../../backend/log.js');

// Implemented adapters and services
const OTPAdapter = require('../../../backend/planner/OTP/OTPAdapter.js').OTPAdapter;
const OTPService = require('../../../backend/planner/OTP/OTPService.js').OTPService;

// Function for logging 
function log(type, msg) {
    logService.write(process.env.FE_MODULE_NAME, type, msg);
}

// Main request processing function
async function processRequest(url, req, res) {

    // Get the selected service identifier from .env file
    const selectedPlannerService = process.env.BE_PLANNER_MODULE_SERVICE;

    // Get new instance of adapter for the selected service 
    const adapter = getPlannerAdapter(selectedPlannerService);
    if (!adapter) {
        log('error', `The selected route planner service (${selectedPlannerService}) does not exist`);
        res.send(null);
        return;
    }

    // Call operation in adapter based on first part of URL
    switch(url[0]) {

        // Endpoint to get all stops in the transport system
        case 'allStops': {
            res.send(await adapter.getAllStops());
            break;
        }

        // Unexpected endpoint
        default: {
            log('error', `Endpoint with this url (${url[0]}) does not exist`);
            res.send(null);
            break;
        }
    }
}

function getPlannerAdapter(selected) {

    // Create new instance of selected service and create adapter for it
    switch(selected) {
        case 'otp': {
            const service = new OTPService();
            return new OTPAdapter(service);
        }
        default: {
            return null;
        }
    }
}

module.exports = { processRequest, env }