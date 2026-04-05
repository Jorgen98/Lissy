/*
 * File: api.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * File for processing API requests for the planner module.
 */

const logService = require('../log.js');
const dbPostgis = require('../db-postgis.js');

import env from '../../frontend/modules/planner/config.json';

import { TripRequest } from './types/TripRequest';
import { planTrip } from './tripOrchestrator';
import { RoutePlanner } from './RoutePlanner';
import { reverseGeocodeNominatim } from './geo';
import { LatLng } from './types/LatLng';
import { TripSectionOption } from './types/TripOption';
import { getLegShape } from './shaping';

// Implemented adapters and services in TypeScript
import { OTPAdapter } from './OTP/OTPAdapter';
import { OTPService } from './OTP/OTPService';

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.FE_MODULE_NAME, type, msg);
}

// Main request processing function
async function processRequest(url: any, req: any, res: any): Promise<void> {

    // Get the selected service identifier from .env file
    const selectedPlannerService = process.env.BE_PLANNER_MODULE_SERVICE;
    if (!selectedPlannerService) {
        log('error', `A route planner service was not selected in .env`);
        res.send(null);
        return;
    }

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
            res.send(await dbPostgis.getActiveStations());
            break;
        }

        // Main endpoint for planning a trip
        case 'planTrip': {

            // Get the user request as TripRequest object
            const tripData = req.body as TripRequest; 

            // Call root function for planning entire trip with the received data and adapter
            res.send(await planTrip(tripData, adapter));
            break;
        }

        // Endpoint for reverse geocoding coordinates into some place name
        case 'reverseGeocode': {
            const coords = JSON.parse(req.query.data) as LatLng;
            res.send(await reverseGeocodeNominatim(coords));
            break;
        }

        // Endpoint for getting the shape of a return trip, which isnt computed in the original trip request
        case 'getReturnTripShape': {
            const returnTrip = req.body as { section: TripSectionOption, hasShape: boolean };

            // Find shapes of all legs concurrently
            await Promise.all(returnTrip.section.legs.map(leg => getLegShape(leg)));
            returnTrip.hasShape = true;

            // Return the mutated return trip object with shapes
            res.send(returnTrip);
            break;
        }

        // Endpoint to get the planner configuration with default values from DB
        case 'getConfig': {
            const plannerConfig = await dbPostgis.getPlannerConfig(process.env.BE_PLANNER_CONFIG_NAME);
            if (!plannerConfig)
                res.send(null);
            else {
                res.send({ 
                    fuel_price_default: parseFloat(plannerConfig.fuel_price_default), 
                    avg_fuel_consumption_default: parseFloat(plannerConfig.avg_fuel_consumption_default), 
                    region_geom: plannerConfig.region_geom 
                });
            }
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

// Function creating an instance of adapter implementing the RoutePlanner interface based on the selected service
function getPlannerAdapter(selected: string): RoutePlanner | null {

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