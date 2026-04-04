/*
 * File: be-processing-planner.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Extra processing operations needed to be done for the planner module.
 */

const { fetchWithRetry } = require('./utils/fetchWithRetry');
const dbPostgis = require('./db-postgis.js');
const logService = require('./log.js');
const routingService = require('./routing.js');

function log(type, msg) {
    logService.write(process.env.BE_PROCESSING_MODULE_NAME, type, msg)
}

// Function fetching fuel prices in the last couple of days and updating the planner config with the calculated average fuel price
async function updateFuelPrice() {

    // Get and check necessary environment variables for the latest fuel price request
    const fuelPriceUrl = process.env.BE_PLANNER_FUEL_PRICE_URL;
    const plannerConfigName = process.env.BE_PLANNER_CONFIG_NAME;
    if (!fuelPriceUrl || !plannerConfigName) {
        log("warning", "Missing environment variables for getting latest fuel price from data.kurzy.cz");
        return;
    }

    // Call the given URL and get price data in the last couple days 
    const response = await fetchWithRetry(fuelPriceUrl, {
        method: "GET",
    }, 3, 5000);
    if (!response) {
        log("warning", `Failed to fetch latest fuel prices from ${fuelPriceUrl}`);
        return;
    }
    const data = await response.json();

    // Find the petrol and diesel price comodities
    const petrol = data.find(comodity => comodity.kod === "benzin-cz");
    const diesel = data.find(comodity => comodity.kod === "motorova-nafta");
    const petrolPrices = petrol.data.map(entry => entry.hodnota); 
    const dieselPrices = diesel.data.map(entry => entry.hodnota); 

    // Get average price across both
    const prices = [...petrolPrices, ...dieselPrices];
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    // Update the currently selected config with the calculated average fuel price
    if (!await dbPostgis.updateFuelPrice(process.env.BE_PLANNER_CONFIG_NAME, parseFloat(avgPrice.toFixed(2))))
        log("warning", "Failed to update default fuel price in DB");
    else
        log("info", "Default fuel price in DB succesfully updated");
}

// Function for finding nearby parking near active transport systems stations with Overpass API
async function findParkingNearStations() {

    const envEmail = process.env.BE_PLANNER_USER_AGENT_EMAIL;
    const overpassUrl = process.env.BE_PLANNER_OVERPASS_URL;

    if (!envEmail || !overpassUrl) {
        log("warning", "Missing environment variables for fetching parking spots with overpass API");
        return false;
    }

    // Get bounds of region set in .env
    const boundsLatMin = process.env.BE_PLANNER_REGION_BOUNDS_LAT_MIN;
    const boundsLatMax = process.env.BE_PLANNER_REGION_BOUNDS_LAT_MAX;
    const boundsLngMin = process.env.BE_PLANNER_REGION_BOUNDS_LNG_MIN;
    const boundsLngMax = process.env.BE_PLANNER_REGION_BOUNDS_LNG_MAX;
    if (boundsLatMin === undefined || boundsLatMax === undefined || boundsLngMax === undefined || boundsLngMin === undefined) {
        log("warning", "Missing environment variables with transport system bounds for fetching parking spots with overpass API");
        return false;
    }
    const boundsString = `${boundsLatMin},${boundsLngMin},${boundsLatMax},${boundsLngMax}`;

    // Create query to get all transit stops within bounding box (3 minute timeout)
    const query = `
        [out:json][timeout:180];
        (
            node["amenity"="parking"]["access"="yes"](${boundsString});
            way["amenity"="parking"]["access"="yes"](${boundsString});
            relation["amenity"="parking"]["access"="yes"](${boundsString});
        );
        out center;
    `;

    // Call overpass at URL in .env with user agent
    // A couple delayed retires, public overpass tends to fail
    const response = await fetchWithRetry(overpassUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": `Lissy (${envEmail})`,
        },
        body: new URLSearchParams({
            data: query
        })
    }, 3, 5000);

    if (!response) {
        log("warning", "Failed to fetch region parking lots with Overpass API.");
        return false;
    }

    const data = await response.json();

    // Parse and filter the received parking options
    const parkings = data.elements.map(element => {
        if (element.type === "node") 
            return { lat: element.lat, lng: element.lon };
        if (element.center)
            return { lat: element.center.lat, lng: element.center.lon };
        return null;            
    }).filter(Boolean); // filter(Boolean) to remove falsy values

    // Get all active stations in the system from DB
    const stations = await dbPostgis.getActiveStations();
    if (!stations)
        return false;

    const totalStations = stations.stops.length;

    // Look for closest parking spot for all stations
    for (let idx = 0; idx < totalStations; idx++) {

        const stop = stations.stops[idx];
        const stopLat = stop.lat;
        const stopLng = stop.lng;
        let nearestParkingDistance = Infinity;
        let nearestParkingCoords = { lat: 0, lng: 0 };

        // Look through the fetched parking options and find nearest to the stop
        for (const parking of parkings) {
            const distance = routingService.countDistance([stopLat, stopLng], [parking.lat, parking.lng]);
            if (distance < nearestParkingDistance) {
                nearestParkingDistance = distance;
                nearestParkingCoords = { lat: parking.lat, lng: parking.lng };
            }
        }

        // Update the DB with coordinates of nearest stop or null based on the straight line distance from station to parking
        const stopId = `0:${stop.name}:${stopLat}:${stopLng}`;
        await dbPostgis.updateStopNearbyParkingCoords(stopId, nearestParkingDistance <= 300 ? nearestParkingCoords : null);

        // Progress reporting
        if ((idx+1) % 500 === 0)
            log("info", `Looking for nearby parking for stations. Progress: ${idx+1}/${totalStations}`);
    };

    return true;
}

module.exports = { updateFuelPrice, findParkingNearStations };