/*
 * File: geo.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Geographic functions.
 */

import { EventEmitter } from "node:stream";
import { NominatimAddressDetails } from "./types/AddressDetails";
import { LatLng } from "./types/LatLng";

const logService = require('../log.js');

// Earth radius in meters
const EARTH_RADIUS = 6_371_000;

// Function for logging 
function log(type: string, msg: string): void {
    logService.write(process.env.BE_PLANNER_MODULE_NAME, type, msg);
}

/* Nominatim requests rate limiting system */

// Whether a nominatim request can currently be made
let nominatimRequestAvailable = true;

// EventEmitter to notify that the cooldown has been released
const events = new EventEmitter();

// Wait until request is available
async function waitForCooldown(): Promise<void> {

    // Wait for cooldown expire
    while (!nominatimRequestAvailable)
        await new Promise(resolve => events.once("nominatimRequestAvailable", resolve));

    nominatimRequestAvailable = false;
}

// Start cooldown timer for 'ms' milliseconds
function releaseCooldown(ms: number = 1100): void {
    setTimeout(() => {

        // Set request available and emit event when cooldown expires
        nominatimRequestAvailable = true;
        events.emit("nominatimRequestAvailable");
    }, ms);
}
/*************************************** */

// Function calling the public Nominatim API to reverse geocode coordinates into a descriptive name
export async function reverseGeocodeNominatim(coords: LatLng): Promise<{ placeName: string | null }> {

    // Get and check environment variables
    const envUrl = process.env.BE_PLANNER_NOMINATIM_URL;
    const envEmail = process.env.BE_PLANNER_USER_AGENT_EMAIL;
    if (!envUrl || !envEmail) {
        log("warning", "Environment variables are invalid for nominatim reverse geocoding requests.");
        return { placeName: null };
    }

    // Create URL with query string parameters
    const url = new URL(envUrl); 
    url.searchParams.append("lat", `${coords.lat}`);
    url.searchParams.append("lon", `${coords.lng}`);
    url.searchParams.append("format", "json");
    url.searchParams.append("addressDetails", "1");
    url.searchParams.append("zoom", "18");
    url.searchParams.append("layer", "address,poi,natural,manmade");
    url.searchParams.append("email", envEmail); 

    // Wait until a request is available
    await waitForCooldown();
    try {

        // Make request with User-Agent header as per Nominatim usage policy
        const response = await fetch(url, {
            headers: {
                "User-Agent": `Lissy (${envEmail})`,
            }
        });
        if (!response.ok){
            log("warning", "Failed to reverse geocode coordinates to place name with Nominatim.");
            return { placeName: null };
        }

        // Get reponse data and build the place name
        const data = await response.json();
        const addressDetails = data.address as NominatimAddressDetails;
        return { placeName: createPlaceName(addressDetails) };
    }
    catch (error) {
        log("warning", "Failed to reverse geocode coordinates to place name with Nominatim.");
        return { placeName: null };
    }
    finally {
        releaseCooldown();  // Start cooldown timer after the request is finished
    }
}

// Function building a descriptive place name from the provided address details
function createPlaceName(details: NominatimAddressDetails): string | null {

    // Some specific point of interest with its own name
    const pointOfInterest =
        details.shop ??
        details.retail ??
        details.amenity ?? 
        details.tourism ??
        details.commercial ??
        details.natural ??
        details.historic ??
        details.leisure ?? 
        details.industrial ??
        details.aeroway ??
        details.railway ??
        details.house_name ?? 
        details.place ??
        details.office ??
        details.man_made ??
        details.club ??
        details.craft;

    // Street (or road number) and house number
    const houseNumber = details.house_number;
    const roadOrStreet = details.road;

    // Some subpart of a town/city
    let townSubdivision = 
        details.city_district ??
        details.borough ??
        details.suburb ??
        details.neighbourhood ??
        details.quarter;

    // Village, city or town
    const town =
        details.village ??
        details.town ??
        details.city;

    // Bigger regions to fallback onto if a small amount of more detailed info exists
    const generalFallback =
        details.state_district ??
        details.municipality ??
        details.county ??
        details.state;

    // Ignore the town/city subdivision name if its the same as the town/city name
    if (townSubdivision === town)
        townSubdivision = undefined;

    // Build structured string based on available information detail  
    if (pointOfInterest) {
        if (townSubdivision)
            return `${pointOfInterest}, ${townSubdivision}, ${town}`;
        return `${pointOfInterest}, ${town}`;
    }
    else if (roadOrStreet) {
        if (houseNumber && townSubdivision)    
            return `${roadOrStreet} ${houseNumber}, ${townSubdivision}, ${town}`;
        else if (houseNumber)
            return `${roadOrStreet} ${houseNumber}, ${town}`;
        else if (townSubdivision)
            return `${roadOrStreet}, ${townSubdivision}, ${town}`;
        return `${roadOrStreet}, ${town}`; 
    }
    else if (townSubdivision) {
        if (houseNumber)    
            return `${townSubdivision} ${houseNumber}, ${town}`;
        return `${townSubdivision}, ${town}`
    }
    else if (town) {
        if (houseNumber)    
            return `${town} ${houseNumber}, ${generalFallback}`;
        return `${town}, ${generalFallback}`
    }

    // At least the town/city/village name has to be available
    return null;
}

// Function using the haversine formula to calculate straight line distance between two points in meters
export function calculateDistanceHaversine(pointA: LatLng, pointB: LatLng): number {

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
    return EARTH_RADIUS * omega;
}

// Function getting coordinates of a point along the straight line between pointA and pointB, 'f' is the fraction of distance from pointA where the point shall be found
// https://www.movable-type.co.uk/scripts/latlong.html
export function getIntermediatePoint(pointA: LatLng, pointB: LatLng, f: number, d: number): LatLng {

    // Convert lat/lng degrees to radians
    const pointALat = pointA.lat * Math.PI / 180;
    const pointALng = pointA.lng * Math.PI / 180;
    const pointBLat = pointB.lat * Math.PI / 180;
    const pointBLng = pointB.lng * Math.PI / 180;

    const sin = Math.sin;
    const cos = Math.cos;
    const atan2 = Math.atan2;

    // Get angular distance between the two points and its sin
    const delta = d / EARTH_RADIUS;
    const sinDelta = sin(delta);
    if (sinDelta === 0)
        return pointA;

    const a = sin((1 - f) * delta) / sinDelta;
    const b = sin(f * delta) / sinDelta;
    const x = a * cos(pointALat) * cos(pointALng) + b * cos(pointBLat) * cos(pointBLng);
    const y = a * cos(pointALat) * sin(pointALng) + b * cos(pointBLat) * sin(pointBLng);
    const z = a * sin(pointALat) + b * sin(pointBLat);

    const latRadians = atan2(z, Math.sqrt(x*x + y*y));
    const lngRadians = atan2(y, x);
    return { 
        lat: latRadians * 180 / Math.PI, 
        lng: lngRadians * 180 / Math.PI
    };
}