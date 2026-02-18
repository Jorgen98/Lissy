const IRoutePlanner = require('../IRoutePlanner.js').IRoutePlanner;     // RoutePlanner interface

/* 
Adapter for OpenTripPlanner2 instance
*/
class OTPAdapter extends IRoutePlanner {
    constructor(otpService) {
        super();
        this.otpService = otpService;
    }

    // Get all stops for autocomplete in the trip form and for latitude and longitude values from OTP instance and translate
    async getAllStops() {

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

module.exports = { OTPAdapter };