const IRoutePlanner = require('./IRoutePlanner.js').IRoutePlanner;     // RoutePlanner interface

/* 
Adapter for OpenTripPlanner2 instance
*/
class OTPAdapter extends IRoutePlanner {
    constructor(otpService) {
        super();
        this.otpService = otpService;
    }
};

module.exports = { OTPAdapter };