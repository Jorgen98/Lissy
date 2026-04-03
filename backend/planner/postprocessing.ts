/*
 * File: postprocessing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for performing postprocessing operations on trips and trip sections.
 * Mostly deriving and calculating new data.
 */

const dbPostgis = require("../db-postgis.js");

import { TripOption, TripSectionOption, TripSectionLeg } from "./types/TripOption";
import { TripRequest } from "./types/TripRequest";
import { UserPreferences, TicketType } from "../../frontend/modules/planner/types/TripDataExtended";
import { CAR_MAINTENANCE_FACTOR, EMISSION_FACTORS } from "./utils/criteriaConstants";
import { Ticket } from "./types/Ticket";
import { RATING_WEIGHTS } from "./utils/tripRatingWeights";

let availableTickets: Ticket[] | null = null;

// Function performing postprocessing operations on all of the found trip options
export async function postprocessTripOptions(options: TripOption[], request: TripRequest): Promise<void> {

    // Get available transport system tickets from the DB
    availableTickets = await dbPostgis.getAvailableFareTickets() as Ticket[] | null;

    for (const option of options) {
        // Get a flat list of legs on the trip
        const legs = option.sections.flatMap(section => section.legs);

        // Add place names to sections origins and destinations based on the data from trip request
        addPlaceNames(option, request);       
        
        // Add number of transfer in the trip option
        addNumberOfTransfers(legs, option);

        // Add cost information for the trip option
        await addPricing(legs, option, request.preferences);
    }
}

// Function filtering the input trips based on pareto-optimalty
export function getParetoOptimalTrips(options: TripOption[]): TripOption[] {
    return options.filter((optionB, idx) => {
        for (let i = 0; i < options.length; i++) {
            if (i === idx) continue;

            // If the current option is dominated by any other option, filter out
            if (dominates(options[i]!, optionB))
                return false;
        }
        return true;
    });
}

// Function deciding whether tripA dominates tripB
// Dominates = is at least as good in all criteria and strictly better then at least one criteria
function dominates(tripA: TripOption, tripB: TripOption): boolean {

    let betterInOne = false;

    if (tripA.cost! < tripB.cost!) 
        betterInOne = true;
    else if (tripA.cost! > tripB.cost!)
        return false;

    if (tripA.duration! < tripB.duration!) 
        betterInOne = true;
    else if (tripA.duration! > tripB.duration!)
        return false;

    if (tripA.emissions! < tripB.emissions!) 
        betterInOne = true;
    else if (tripA.emissions! > tripB.emissions!)
        return false;

    if (tripA.numTransfers! < tripB.numTransfers!) 
        betterInOne = true;
    else if (tripA.numTransfers! > tripB.numTransfers!)
        return false;

    return betterInOne;
}

// Function performing postprocessing operations on trip sections
export async function postprocessTripSections(options: TripSectionOption[], preferences: UserPreferences): Promise<void> {
    for (const option of options) {
        // Add cost information to sections
        await addPricing(option.legs, option, preferences);

        // Add emission levels to sections
        addEmissions(option);

        // Add number of transfer in the trip sections
        addNumberOfTransfers(option.legs, option);
    }
}

// Function accumulating the prices of usage of modes in a single trip section or trip option
// The 'legs' parameter is a flat list of legs of a trip section of a full trip option
// The 'object' parameter is either a trip section of a full trip option, both of which have the 'cost' field
async function addPricing(legs: TripSectionLeg[], object: TripSectionOption | TripOption, preferences: UserPreferences): Promise<void> {

    // Calculate the price of using public transport
    const publicTransportPrice = await calculatePublicTransportPrice(legs, preferences.publicTransport.ticketType);

    // Calculate the price of using car
    const carPrice = calculateCarPrice(legs, preferences.car.avgFuelConsumption, preferences.car.fuelPrice);

    // Adjust object with total estimated cost
    object.cost = publicTransportPrice + carPrice;
}

// Function calculating the price of using the car from a list of legs
// Usable for both a trip section and a full trip option with multiple sections, since a list of legs is passed in
function calculateCarPrice(legs: TripSectionLeg[], avgConsumption: number, fuelPrice: number) {

    // Get total distance of legs using the car
    let carDistanceMeters = 0;
    legs.forEach(leg => {
        if (leg.mode === "CAR")
            carDistanceMeters += leg.distance;
    });

    // Convert to kilometers
    const carDistanceKm = carDistanceMeters / 1000;

    // Formula to calculate total car price of section
    // (km * 100l/km * czk/l) / 100 ==> czk 
    const sectionFuelCost = (carDistanceKm * avgConsumption * fuelPrice) / 100;
    const sectionMaintenanceCost = carDistanceKm * CAR_MAINTENANCE_FACTOR;
    return sectionFuelCost + sectionMaintenanceCost; 
}

// Function calculating the price of using public transport from a list of legs
// Usable for both a trip section and a full trip option with multiple sections, since a list of legs is passed in
async function calculatePublicTransportPrice(legs: TripSectionLeg[], ticketType: TicketType): Promise<number> {

    // Get first and last transit legs of the section
    const firstTransitLeg = legs.find(leg => leg.isTransitLeg);
    const lastTransitLeg = legs.findLast(leg => leg.isTransitLeg);
    if (!firstTransitLeg || !lastTransitLeg)
        return 0;

    // Get time when transit begins, and when it ends
    const transitStartTime = firstTransitLeg.from.departureTime;
    const transitEndTime = lastTransitLeg.to.arrivalTime;

    // Create a list of unique transport system zones used in the section
    const uniqueZones = new Set<string>();
    legs.forEach(leg => {
        if (leg.zones) {
            leg.zones.forEach(zone => {
                uniqueZones.add(zone);
            });
        }
    });

    // Get the minutes and zone count needed on the ticket
    const neededMinutes = Math.ceil((transitEndTime.getTime() - transitStartTime.getTime()) / (1000 * 60));
    const neededZoneNum = uniqueZones.size;

    // Find cheapest ticket that satisfies conditions (or use fallback)
    const ticket = await findCheapestTicket(neededMinutes, neededZoneNum);
    if (!ticket)
        return 0;

    // Get price based on selected ticket
    if (ticketType === "discountedB")
        return ticket.discounted_b_price;
    else if (ticketType === "discountedA")
        return ticket.discounted_a_price;
    else 
        return ticket.base_price;

}

// Function finding the cheapest ticket from the fare system that satisfies the criteria
async function findCheapestTicket(neededDuration: number, neededZones: number): Promise<Ticket | null> {
    if (availableTickets === null || availableTickets.length === 0)
        return null;

    // Find cheapest ticket that satisfies conditions
    let bestTicket: Ticket | null = null;
    availableTickets.forEach(ticket => {
        if (!ticket.is_universal) {
            if (neededZones <= ticket.zones && neededDuration <= ticket.duration) {
                if (bestTicket === null || bestTicket.base_price > ticket.base_price)
                    bestTicket = ticket;
            }
        }
    });

    // Fall back to universal ticket
    if (bestTicket === null)
        bestTicket = availableTickets.find(ticket => ticket.is_universal) ?? null;

    return bestTicket;
}

// Function calculating emissions for a trip section
function addEmissions(section: TripSectionOption) {

    // No need to calculate if the emissions were defined earlier
    if (section.emissions !== null)
        return; 

    // Accumulate emissions from legs of the section
    let totalEmissions = 0;
    section.legs.forEach(leg => {
        totalEmissions += EMISSION_FACTORS[leg.mode] * (leg.distance / 1000);
    });

    // Update the object
    section.emissions = totalEmissions;
}

// Function calculating the number of transfers for one trip option
function addNumberOfTransfers(legs: TripSectionLeg[], object: TripSectionOption | TripOption): void {

    // Count number of transfers
    let possibleTransfer = false;
    let numTransfers = 0;
    legs.forEach(leg => {
        if (leg.mode === "CAR")
            possibleTransfer = true;
        else if (leg.mode !== "WALK") {
            if (possibleTransfer)
                numTransfers++;
            else
                possibleTransfer = true;
        }
    });

    // Update the trip object
    object.numTransfers = numTransfers;
}

// Function adding place names to section origin points and destination points where they arent yet set
export function addPlaceNames(trip: TripOption, request: TripRequest, returnTrip: boolean = false): void {
    trip.sections.forEach((section, index) => {

        // Get the possible new names for section origin and destination from the request
        // Reverse the first and last point if the return trip flag is true
        const originPointName = !returnTrip ? request.points[index]!.placeName : request.points[request.points.length - 1]!.placeName;
        const destPointName = !returnTrip ? request.points[index + 1]!.placeName : request.points[0]!.placeName;

        // Update the section origin name if its available and not set yet
        if (originPointName !== undefined && section.originName === null) 
            section.originName = originPointName;

        // Same with destination
        if (destPointName !== undefined && section.destinationName === null) 
            section.destinationName = destPointName;

        // If the origin of the first leg doesnt have a name, can fill with the origin name of the section
        if (originPointName !== undefined && section.legs[0]!.from.placeName === null)
            section.legs[0]!.from.placeName = originPointName;

        // Same with destination of the last legs and section destination name
        if (destPointName !== undefined && section.legs[section.legs.length - 1]!.to.placeName === null)
            section.legs[section.legs.length - 1]!.to.placeName = destPointName;
    });
}

// Function adding a score to each trip option/section, calculated from the chosen criteria
export function rateOptions(objects: TripOption[] | TripSectionOption[]): void {

    if (objects.length === 0)
        return;

    const addTags = 'fastest' in objects[0]!;

    // Minimum and maximum value object
    const minMaxs = {
        duration: { min: Infinity, max: 0 },
        cost: { min: Infinity, max: 0 },
        numTransfers: { min: Infinity, max: 0 },
        emissions: { min: Infinity, max: 0 },
    };

    // Get minimum and maximum values for each criteria for min-max normalization
    objects.forEach(object => {
        (Object.keys(minMaxs) as (keyof typeof minMaxs)[]).forEach(criteriaKey => {
            const minMaxCriteria = minMaxs[criteriaKey];
            const tripCriteriaValue = object[criteriaKey]!;
            minMaxCriteria.max = Math.max(minMaxCriteria.max, tripCriteriaValue);
            minMaxCriteria.min = Math.min(minMaxCriteria.min, tripCriteriaValue);
        });
    });

    // Calculate score for each trip option with min-max normalization to 0-100 range
    let maxIdx = 0;
    let fastestSet = false;
    let cheapestSet = false;
    objects.forEach((object, idx) => {
        const score = (Object.keys(minMaxs) as (keyof typeof minMaxs)[]).reduce((score, criteriaKey) => {
            const { min, max } = minMaxs[criteriaKey];
            const value = object[criteriaKey]!;

            // Mark fastest and cheapest trips with flags (only first one if equal)
            if (!fastestSet && criteriaKey === "duration" && min === value) {
                if (addTags) (object as TripOption).fastest = true
                fastestSet = true;
            }
            else if (!cheapestSet && criteriaKey === "cost" && min === value) {
                if (addTags) (object as TripOption).cheapest = true
                cheapestSet = true;
            }

            let normalized;
            if (max - min === 0)
                normalized = 0;
            else 
                normalized = 100 - ((value - min) / (max - min)) * 100; // higher score === better trip

            // Multiply by criteria weights and sum all criteria scores
            return score + normalized * RATING_WEIGHTS[criteriaKey];
        }, 0);

        // Update the object with calculated score
        object.score = score;
        if (score > objects[maxIdx]?.score!) maxIdx = idx;
    });

    // Mark trip with best score as best
    if (addTags) (objects[maxIdx]! as TripOption).best = true; 
}