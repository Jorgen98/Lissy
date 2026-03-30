/*
 * File: criteriaConstants.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Definitions and descriptions of coefficients/constants used for evaluating the criteria trips/sections are ranked based on.
 */

import { Mode } from "../types/Mode";

// Grams of CO2 per kilometer per passenger for each mode
// Car, bus, rail from https://www.rekrabicka.cz/blog/ekologicky-dopad-dopravnich-prostredku
// Other unmentioned modes given assumed values
export const EMISSION_FACTORS: Record<Mode, number> = {
    WALK: 0,
    CAR: 192,
    BUS: 68,
    FERRY: 10,
    RAIL: 14,
    TRAM: 10,
    TROLLEYBUS: 10
};

// A rough estimate of the service cost per km of a car journey 
export const CAR_MAINTENANCE_FACTOR = 2; 