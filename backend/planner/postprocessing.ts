/*
 * File: postprocessing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for performing postprocessing operations on trips and trip sections.
 * Mostly deriving and calculating new data.
 */

import { TripOption, TripSectionOption, TripSectionLeg } from "./types/TripOption";
import { TripRequest } from "./types/TripRequest";
import { UserPreferences, TicketType } from "../../frontend/modules/planner/types/TripDataExtended";
import { IDS_JMK_FARE_SYSTEM, EMISSION_FACTORS, Ticket } from "./utils/criteriaConstants";

// Function performing postprocessing operations on all of the found trip options
export function postprocessTripOptions(options: TripOption[], request: TripRequest): void {
    options.forEach(option => {

        // Get a flat list of legs on the trip
        const legs = option.sections.flatMap(section => section.legs);

        // Add place names to sections origins and destinations based on the data from trip request
        addPlaceNames(option, request);       
        
        // Add number of transfer in the trip option
        addNumberOfTransfers(legs, option);

        // Add cost information for the trip option
        addPricing(legs, option, request.preferences);
    });
}

// Function performing postprocessing operations on trip sections
export function postprocessTripSections(options: TripSectionOption[], preferences: UserPreferences): void {
    options.forEach(option => {

        // Add cost information to sections
        addPricing(option.legs, option, preferences);

        // Add emission levels to sections
        addEmissions(option);

        // Add number of transfer in the trip sections
        addNumberOfTransfers(option.legs, option);
    });
}

// Function accumulating the prices of usage of modes in a single trip section or trip option
// The 'legs' parameter is a flat list of legs of a trip section of a full trip option
// The 'object' parameter is either a trip section of a full trip option, both of which have the 'cost' field
function addPricing(legs: TripSectionLeg[], object: TripSectionOption | TripOption, preferences: UserPreferences): void {

    // Calculate the price of using public transport
    const publicTransportPrice = calculatePublicTransportPrice(legs, preferences.publicTransport.ticketType);

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
    return (carDistanceKm * avgConsumption * fuelPrice) / 100;
}

// Function calculating the price of using public transport from a list of legs
// Usable for both a trip section and a full trip option with multiple sections, since a list of legs is passed in
function calculatePublicTransportPrice(legs: TripSectionLeg[], ticketType: TicketType): number {

    // Get first and last transit legs of the section
    const firstTransitLeg = legs.find(leg => leg.mode !== "WALK" && leg.mode !== "CAR");
    const lastTransitLeg = legs.findLast(leg => leg.mode !== "WALK" && leg.mode !== "CAR");
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
    const ticket = findCheapestTicket(neededMinutes, neededZoneNum);

    // Get the price based on the used ticket (could be discounted)
    return ticket[ticketType];
}

// Function finding the cheapest ticket from the fare system that satisfies the criteria
function findCheapestTicket(neededDuration: number, neededZones: number): Ticket {

    let bestTicket: Ticket | null = null;

    // Enforce types on the FARE_SYSTEM object when using Object.values
    const typedFareSystem = Object.entries(IDS_JMK_FARE_SYSTEM) as [keyof typeof IDS_JMK_FARE_SYSTEM, typeof IDS_JMK_FARE_SYSTEM[keyof typeof IDS_JMK_FARE_SYSTEM]][];

    // Iterate through entries in the fare system and find the cheapest ticket that satisfies needed zones and duration
    for (const [key, ticket] of typedFareSystem) {
        if (key === "universal")
            continue;

        const zonesInTicket = key === "short2" || key === "long2" ? 2 : (key === "all" ? Infinity : key);
        const durationInTicket = ticket.duration;
        if (zonesInTicket >= neededZones && durationInTicket >= neededDuration) {
            if (bestTicket === null)
                bestTicket = ticket;
            else if (bestTicket.base > ticket.base)
                bestTicket = ticket;
        }
    }

    // Fallback if the a valid ticket isnt found (because transit is too long in duration)
    if (bestTicket === null)
        bestTicket = IDS_JMK_FARE_SYSTEM["universal"];

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
function addPlaceNames(trip: TripOption, request: TripRequest): void {
    trip.sections.forEach((section, index) => {

        // Get the possible new names for section origin and destination from the request
        const originPointName = request.points[index]!.placeName;
        const destPointName = request.points[index + 1]!.placeName;

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