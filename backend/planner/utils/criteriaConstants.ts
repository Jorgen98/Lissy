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
}

// Object and type for approximating fares of public transport, since they arent available in IDS JMK GTFS
// https://content.idsjmk.cz/cenik/240701/Cenik.pdf
export type Ticket = { duration: number, base: number, discountedA: number, discountedB: number };
export const IDS_JMK_FARE_SYSTEM: Record<number | "all" | "short2" | "long2" | "universal", Ticket> = {

    // Key is the number of zones, the value is an object storing 
    // the time for which the ticket is valid, base price and discounted prices
    "short2": {
        duration: 15,
        base: 20,
        discountedA: 10,
        discountedB: 20,
    },
    "long2": {
        duration: 60,
        base: 25,
        discountedA: 12,
        discountedB: 25,
    },
    3: {
        duration: 90,
        base: 33,
        discountedA: 16,
        discountedB: 31,
    },
    4: {
        duration: 90,
        base: 41,
        discountedA: 20,
        discountedB: 35,
    },
    5: {
        duration: 120,
        base: 49,
        discountedA: 24,
        discountedB: 39,
    },
    6: {
        duration: 120,
        base: 57,
        discountedA: 28,
        discountedB: 43,
    },
    7: {
        duration: 150,
        base: 65,
        discountedA: 32,
        discountedB: 47,
    },
    8: {
        duration: 150,
        base: 73,
        discountedA: 36,
        discountedB: 51,
    },
    9: {
        duration: 180,
        base: 81,
        discountedA: 40,
        discountedB: 55,
    },
    10: {
        duration: 180,
        base: 89,
        discountedA: 44,
        discountedB: 59,
    },
    11: {
        duration: 210,
        base: 97,
        discountedA: 48,
        discountedB: 63,
    },
    12: {
        duration: 210,
        base: 105,
        discountedA: 52,
        discountedB: 67,
    },
    "all": {
        duration: 240,
        base: 113,
        discountedA: 56,
        discountedB: 71,
    },

    // Fallback
    "universal": {
        duration: Infinity,
        base: 180,
        discountedA: 90,
        discountedB: 90,
    }
};