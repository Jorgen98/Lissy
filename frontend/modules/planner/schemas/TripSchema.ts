/*
 * File: TripSchema.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Schema for validating object of the TripOption type, received from file import.
 */

import { z } from "zod";
import { modes } from "../types/Mode";

// Function that takes a string value and attempts to convert it to a Date object
const datePreprocess = (_: string) => z.preprocess(
        value => (typeof value === "string" ? new Date(value) : value),
        z.date()
    );

// Schema for one leg of a trip section 
const LegSchema = z.object({
    duration: z.number().positive(),
    distance: z.number().positive(),
    from: z.object({
        arrivalTime: datePreprocess("arrivalTime").nullable(),
        departureTime: datePreprocess("departureTime"),
        placeName: z.string().nullable(),
        isTransportStop: z.boolean(),
        isParking: z.boolean(),
    }),
    points: z.array(z.object({
        lat: z.number(),
        lng: z.number(),
    })).min(1),
    to: z.object({
        arrivalTime: datePreprocess("arrivalTime"),
        departureTime: datePreprocess("departureTime").nullable(),
        placeName: z.string().nullable(),
        isTransportStop: z.boolean(),
        isParking: z.boolean(),
    }),
    mode: z.enum(modes),
    route: z.object({
        lineId: z.string().nullable(),
        color: z.string().regex(/^[0-9A-Fa-f]{6}$/).nullable(),
        textColor: z.string().regex(/^[0-9A-Fa-f]{6}$/).nullable(),
        gtfsId: z.string().nullable(),
    }).nullable(),
    trip: z.object({
        gtfsId: z.string().nullable(),
    }).nullable()
});

// Schema for one section of a trip 
const SectionSchema = z.object({
    duration: z.number().positive(),
    distance: z.number().positive(),
    startDatetime: datePreprocess("startDatetime"),
    endDatetime: datePreprocess("endDatetime"),
    originName: z.string().nullable(),
    destinationName: z.string().nullable(),
    legs: z.array(LegSchema).min(1),
    emissions: z.number(),
    cost: z.number(),
    numTransfers: z.number(),
});

// Schema for TripOption datatype validation
export const TripSchema = z.object({
    duration: z.number().positive(),
    distance: z.number().positive(),
    startDatetime: datePreprocess("startDatetime"),
    endDatetime: datePreprocess("endDatetime"),
    sections: z.array(SectionSchema).min(1),
    hasFullShape: z.boolean(),
    numTransfers: z.number(),
    emissions: z.number(),
    cost: z.number(),
    score: z.number(),
    returnTrip: SectionSchema.or(z.literal("not available")).nullable(),
});