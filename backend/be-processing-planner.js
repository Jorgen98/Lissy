/*
 * File: be-processing-planner.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Extra processing operations needed to be done for the planner module.
 */

const { fetchWithRetry } = require('./utils/fetchWithRetry');
const dbPostgis = require('./db-postgis.js');
const logService = require('./log.js');

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
        log("warning", "Failed to fetch update default fuel price in DB");
}

module.exports = { updateFuelPrice };