/*
 * File: ValhallaAdapter.ts
 * Author: Adam Vcelar (xvcelaa00) 
 *
 * Translating adapter class for Valhalla.
 */

const logService = require('../../../log.js');

import { RoutePlanner } from "../RoutePlanner";
import { ValhallaService } from "./ValhallaService";
import { TripSectionInfo } from "../../types/TripSectionInfo";
import { TripSectionOption } from "../../types/TripOption";
import { RouteQueryParams } from "./types/RouteQueryParams";

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

/* 
Adapter for Valhalla instance
*/
export class ValhallaAdapter implements RoutePlanner {

    constructor(
        private valhallaService: ValhallaService
    ) { }


    // Get a route between two points using Valhalla /route endpoint
    // Function translating the inputs to the format needed by Valhalla and the outputs to the format needed by client
    // Returns a list of found trip options from the request
    public async getTripSection(sectionInfo: TripSectionInfo, numOptions?: number): Promise<TripSectionOption[] | null> {
        
        const datetime = new Date(sectionInfo.datetime.datetime);
        const datetimeValue = new Date(datetime.getTime() - datetime.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16); 

        const queryParams: RouteQueryParams = {
            pointALat: sectionInfo.pointA.lat,
            pointALng: sectionInfo.pointA.lng,
            pointBLat: sectionInfo.pointB.lat,
            pointBLng: sectionInfo.pointB.lng,
            useBus: sectionInfo.preferences.publicTransport.allowedModes.bus ? 1.0 : 0.0,
            datetimeType: sectionInfo.datetime.option === "departure" ? 1 : 2,
            walkReluctance: sectionInfo.isReroute ? 10.0 : 1.5,
            costing: sectionInfo.modes.car ? "auto" : (sectionInfo.modes.publicTransport ? "multimodal" : "pedestrian"),
            walkingSpeed: sectionInfo.preferences.walk.avgSpeed * 3.6,
            datetimeValue,
        };

        // Call Valhalla service with prepared parameters
        const response = await this.valhallaService.route(queryParams);
        if (!response)
            return null;

        console.log(response);
        // TODO handle errors and translate result

        return null;
    }

    // Function performing any initializations for the ValhallaAdapter, empty implementation
    public async initialize(): Promise<boolean> {
        return true;
    }
};