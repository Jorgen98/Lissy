/*
 * File: OTPAdapter.ts
 * Author: Adam Vcelar (xvcelaa00) 
 *
 * Translating adapter class for OpenTripPlanner.
 */

import { OTPService } from "./OTPService";
import { RoutePlanner } from "../RoutePlanner";
import { Stop } from "../../../frontend/modules/planner/types/Stop";

/* 
Adapter for OpenTripPlanner2 instance
*/
export class OTPAdapter implements RoutePlanner {

    constructor(
        private otpService: OTPService
    ) { }

    // Get all stops for autocomplete in the trip form and for latitude and longitude values from OTP instance and translate
    async getAllStops(): Promise<{ stops: Stop[] } | null> {

        // Call the otp planner service
        const response = await this.otpService.getAllStations();
        if (!response)
            return null;

        // Translate the returned stops to expected form 
        const stops = response.data.stations.map(station => ({
            lat: station.lat,
            lng: station.lon,
            name: station.name
        }));

        return { stops: stops };
    }
};