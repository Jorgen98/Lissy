const logService = require('../log.js');

import proj4 from "proj4";
import * as path from "path";
import * as fs from "fs";
import { PopulationData } from "./types/PopulationData";
import { GeoJSONPoint, parse } from "wellknown";
import { SpatialIndex } from "./types/SpatialIndex";

// Define projection for EPSG:3035 coordinate system used by population data (./data/population_data.geojson)
// https://epsg.io/3035.proj4js
proj4.defs(
    "EPSG:3035",
    "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs"
);

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

// Function using the haversine formula to calculate straight line distance between two points in meters
export function calculateDistanceHaversine(pointA: { lat: number, lng: number }, pointB: { lat: number, lng: number }): number {

    // Earth radius (meters)
    const r = 6_371_000;

    // Convert lat/lng degrees to radians
    const pointALat = pointA.lat * Math.PI / 180;
    const pointBLat = pointB.lat * Math.PI / 180;
    const latDelta = (pointB.lat - pointA.lat) * Math.PI / 180;
    const lngDelta = (pointB.lng - pointA.lng) * Math.PI / 180;

    // Calculate haversine of omega (central angle between the two points on a sphere)
    const cos = Math.cos;
    const havOmega = (1 - cos(latDelta) + cos(pointALat) * cos(pointBLat) * (1 - cos(lngDelta))) / 2;

    // Calculate central angle between the two points on a sphere
    const omega = 2 * Math.asin(Math.sqrt(havOmega));

    // Calculate distance between two points in meters
    return r * omega;
}

// Function converting coordinates of point in EPSG:4326 to EPSG:3035
export function EPSG4326toEPSG3035(lat: number, lng: number): [number, number] {
    return proj4(
        "EPSG:4326", 
        "EPSG:3035",
        [lng, lat]  
    );
}

// Function converting the population data, defined with a grid of 100m by 100m cells into a spatial index for fast lookup
// The spatial holds aggregated data for bigger cells (size given by the paramater)
// Each entry is keyed by a string created from EPSG3035 coordinates and holds the population in that grid cell and a set of stop ids that are in the grid cell or nearby 
export function createSpatialIndex(cellWidthMeters: number): SpatialIndex | null {
    try {
        // Get file content with population and nearby stops information into a JSON
        const filePath = path.join(__dirname, 'data/processed_population_data.geojson');
        const content = fs.readFileSync(filePath, 'utf-8');
        const geoJson: PopulationData = JSON.parse(content);

        // Get list of 100m by 100m sized cells and their population and stops data
        const cells100m = geoJson.features;

        // Prepare an empty index (hash table) keyed by a string
        // The value is an object with population size in the given cell and set of ids of stops
        const spatialIndex = new Map<string, { population: number, stops: Set<string> }>();

        // Iterate over all 100m by 100m cells
        cells100m.forEach(cell100m => {

            // Get center point of the cell in EPSG:3035 (as a string)
            const center3035 = cell100m.properties.subcell_center;

            // Parse the center point into an actual point object using 'wellknown' package
            const geometry = parse(center3035) as GeoJSONPoint;

            // Get the two EPSG:3035 coordinate elements
            const easting = geometry.coordinates[0];
            const northing = geometry.coordinates[1];

            // Easting and northing values are in meters, divide by the cell width parameter and create a key, that will 
            // group the small original cells into a bigger cell given by the parameter 
            const eastingKey = Math.floor(easting / cellWidthMeters);
            const northingKey = Math.floor(northing / cellWidthMeters);
            const key = `${eastingKey}_${northingKey}`;

            // Get population and number of nearby stops from the cell
            const population = cell100m.properties.population;
            const stopIds = getNearbyStops(cell100m.properties.nearby_stops);

            // Try the new key in the partially filled index
            const cell3km = spatialIndex.get(key);
            
            // Add new entry or update existing
            if (!cell3km)
                spatialIndex.set(key, { population, stops: new Set<string>(stopIds) });
            else{
                cell3km.population += population;
                stopIds.forEach(id => {
                    cell3km.stops.add(id);
                });
            }
        });

        // Return filled spatial index with cells of size 'cellWidthMeters' by 'cellWidthMeters'
        return {
            index: spatialIndex,
            ...getSpatialIndexMinMaxes(spatialIndex)
        };
    }
    catch (_) {
        log('error', 'Failed to read population data file.');
        return null;
    }
}

// Function for getting the maximum and minimum values of cell properties in the index
function getSpatialIndexMinMaxes(index: Map<string, { population: number, stops: Set<string> }>): { maxPopulation: number, minPopulation: number, maxStops: number, minStops: number } {

    const minMaxs = {
        maxPopulation: 0,
        minPopulation: Infinity,
        maxStops: 0,
        minStops: Infinity,
    }

    for (const data of index.values()) {
        if (data.population > minMaxs.maxPopulation)
            minMaxs.maxPopulation = data.population;
        else if (data.population < minMaxs.minPopulation)
            minMaxs.minPopulation = data.population;

        if (data.stops.size > minMaxs.maxStops)
            minMaxs.maxStops = data.stops.size;
        else if (data.stops.size < minMaxs.minStops)
            minMaxs.minStops = data.stops.size;
    }

    return minMaxs;
};

// Function get the number of nearby stops from the nearby_stops object in PopulationData type
// NOTE (TODO): This is currently needed because of the format of the population_data.geojson file, which
// has the nearby_stops object as an empty list or a Python-like list of tuples, which isnt valid JSON
function getNearbyStops(nearbyStops: string | any[]): string[] {

    // Python-like list of tuples (string, number), but as a string
    // Look for all stopIds of enclosed in '...'
    if (typeof nearbyStops === "string") {
        const matches = nearbyStops.match(/'([^']*)'/g);
        if (!matches)
            return [];

        // Remove the quotes
        return matches.map(match => match.slice(1, -1));
    }

    // Empty list
    else
        return [];
}