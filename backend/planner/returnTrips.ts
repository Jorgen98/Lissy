/*
 * File: returnTrips.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for executing the search for return trips for trip options.
 */

import { RoutePlanner } from "./RoutePlanner";
import { TripOption, TripSectionOption } from "./types/TripOption";
import { TripRequest } from "./types/TripRequest";
import { addPlaceNames, postprocessTripSections, rateOptions } from "./postprocessing";
import { calculateDistanceHaversine } from "./geo";
import { LatLng } from "./types/LatLng";
import { connectSections } from "./sectionOrchestrator";

// Function attempting to find return trips for each trip option
export async function findReturnTrips(planner: RoutePlanner, options: TripOption[], request: TripRequest) {

    // Create variables for return trips that involve either only car or only public transport
    // They will be the same every time, so no need to request repeatedly
    let carReturnTrip: TripSectionOption | null | "not available" = null;
    let ptReturnTrip: TripSectionOption | null | "not available" = null;

    for (const trip of options) {
        // Check if the arrival time of the original trip is earlier than the requested return datetime
        if (trip.endDatetime.getTime() > new Date(request.return.datetime).getTime())
            trip.returnTrip.section = "not available";

        // Find place where car was left last
        const legs = trip.sections.flatMap(section => section.legs);
        const lastCarLeg = legs.findLast(leg => leg.mode === "CAR");

        // If theres no car leg on the trip, find best public transport section
        if (!lastCarLeg) {
            if (ptReturnTrip === null)
                ptReturnTrip = await findReturnTripPTOnly(planner, request, trip.endDatetime);
            trip.returnTrip.section = ptReturnTrip;
        }
        else {
            // Find spot where car was left at and last leg of the trip
            const carLeftAt = { latLng: lastCarLeg.to.latLng, name: lastCarLeg.to.placeName };
            const lastLeg = legs[legs.length - 1];

            // If the last leg of the trip terminates at the same place the car was left at
            // Find a strictly car trip section, since that is definitely what was used for the original trip
            if (carLeftAt.latLng.lat === lastLeg!.to.latLng.lat && carLeftAt.latLng.lng === lastLeg!.to.latLng.lng) {
                if (carReturnTrip === null)
                    carReturnTrip = await findReturnTripCarOnly(planner, request, trip.endDatetime);
                trip.returnTrip.section = carReturnTrip;
            }

            // Otherwise find return trip that connects a public transport section that terminates at carLeftAt
            // and continues with car to the origin
            else 
                trip.returnTrip.section = await findReturnTripCarPT(planner, request, trip.endDatetime, carLeftAt);
        }

        // If a valid return trip was found, fill in available place names
        if (trip.returnTrip.section !== "not available" && trip.returnTrip.section !== null)
            addPlaceNames({ ...trip, sections: [trip.returnTrip.section] }, request, true);
    }
}

// Function finding a return trip that uses only public transport
async function findReturnTripPTOnly(planner: RoutePlanner, request: TripRequest, tripArrival: Date): Promise<TripSectionOption | "not available"> {

    const datetime = new Date(request.return.datetime);
    const datetimeOption = request.return.datetimeOption;

    // Find public transport sections that depart after the original trip arrival
    const filtered = await getFilteredPtSections(planner, request, request.points[0]!, datetime, datetimeOption, tripArrival);
    if (filtered === null)
        return "not available";

    // Call postprocessing to get data for rating, rate, and sort by calculated rating
    await postprocessTripSections(filtered, request.preferences);
    rateOptions(filtered);
    filtered.sort((a, b) => b.score! - a.score!);

    // Pick best option
    return filtered[0]!;
}

// Function finding a return trip that uses only car
async function findReturnTripCarOnly(planner: RoutePlanner, request: TripRequest, tripArrival: Date): Promise<TripSectionOption | "not available"> {

    // Call RoutePlanner to get car sections between destination and origin
    const carSections = await planner.getTripSection({
        pointA: request.points[request.points.length - 1]!,
        pointB: request.points[0]!,
        datetime: { datetime: request.return.datetime, option: request.return.datetimeOption },
        modes: { car: true, walk: false, publicTransport: false },
        preferences: request.preferences,
    });
    if (!carSections || carSections[0] === undefined)
        return "not available";

    // Get first (only) car section and check if it leaves after the arrival of the original trip
    const carSection = carSections[0];
    if (carSection.startDatetime.getTime() < tripArrival.getTime())
        return "not available";

    return carSection;
}

// Function finding a return trip that uses combination of public transport and car, with a given transit->car transfer point
async function findReturnTripCarPT(
    planner: RoutePlanner, 
    request: TripRequest, 
    tripArrival: Date,
    carLeftAt: { latLng: LatLng, name: string | null }
): Promise<TripSectionOption | "not available"> {

    // If the departure time is set
    if (request.return.datetimeOption === "departure") {

        // Find public transport options that depart after the original trip arrival
        const datetime = new Date(request.return.datetime);
        const filtered = await getFilteredPtSections(planner, request, carLeftAt.latLng, datetime, "departure", tripArrival);
        if (filtered === null)
            return "not available";

        // Find which one of the options is the closest to the parking spot where the car was left in the original trip
        const sectionClosestToParking = findClosestToParking(filtered, carLeftAt.latLng);
        if (sectionClosestToParking === null)
            return "not available";

        // Find car section that leaves after the selected section arrives
        const carSections = await planner.getTripSection({
            pointA: carLeftAt.latLng,
            pointB: request.points[0]!,
            datetime: { datetime: sectionClosestToParking.endDatetime.toISOString(), option: "departure" },
            modes: { car: true, walk: false, publicTransport: false },
            preferences: request.preferences,
        });
        if (!carSections || carSections.length === 0)
            return "not available";
        const carSection = carSections[0]!;

        // Connect the two sections together into one
        return connectSections(carSection, sectionClosestToParking, carLeftAt.name, true);  
    }

    // If the arrival time is set
    else {

        // Find car section that arrives by the selected arrival time
        const carSections = await planner.getTripSection({
            pointA: carLeftAt.latLng,
            pointB: request.points[0]!,
            datetime: { datetime: request.return.datetime, option: "arrival" },
            modes: { car: true, walk: false, publicTransport: false },
            preferences: request.preferences,
        });
        if (!carSections || carSections.length === 0)
            return "not available";
        const carSection = carSections[0]!;

        // Find public transport options that arrive in time to connect to the found car section
        const filtered = await getFilteredPtSections(planner, request, carLeftAt.latLng, carSection.startDatetime, "arrival", tripArrival);
        if (filtered === null)
            return "not available";

        // Find which one is closest to the parking sport
        const sectionClosestToParking = findClosestToParking(filtered, carLeftAt.latLng);
        if (sectionClosestToParking === null)
            return "not available";

        // Shift the car section back in time so it connects exactly to the selected public tranport section
        const gap = carSection.startDatetime.getTime() - sectionClosestToParking.endDatetime.getTime();
        carSection.startDatetime = new Date(carSection.startDatetime.getTime() - gap);
        carSection.endDatetime = new Date(carSection.endDatetime.getTime() - gap);

        // Connect them into a single section
        return connectSections(carSection, sectionClosestToParking, carLeftAt.name, true);  
    }
}

// Function finding public transport sections that leave only after the arrival of the original trip
async function getFilteredPtSections(
    planner: RoutePlanner,
    request: TripRequest,
    pointB: LatLng,
    datetime: Date,
    datetimeOption: "arrival" | "departure",
    tripArrival: Date
): Promise<TripSectionOption[] | null> {

    // Get public transport sections with given parameters from the original trip destination point
    const ptSections = await planner.getTripSection({
        pointA: request.points[request.points.length - 1]!,
        pointB,
        datetime: { datetime: datetime.toISOString(), option: datetimeOption },
        modes: { car: false, walk: false, publicTransport: true },
        preferences: request.preferences,
    });
    if (!ptSections || ptSections.length === 0)
        return null;

    // Filter out ones that leave before the trip arrival
    const filtered = ptSections.filter(sec => sec.startDatetime.getTime() > tripArrival.getTime())
    if (filtered.length === 0)
        return null;

    return filtered;
}

// Function, which, out of a list of trip sections, finds the one that terminates closest to the given parking point
function findClosestToParking(sections: TripSectionOption[], carLeftAtCoords: LatLng): TripSectionOption | null {
    let closestToParkingIdx: number | null = null;
    let closestToParkingDistance: number | null = null;
    sections.forEach((section, idx) => {

        // Get distance between the section destination point and the parking point
        const distanceFromParking = calculateDistanceHaversine(carLeftAtCoords, section.legs[0]!.to.latLng);

        // Update if the distance is closest so far
        if (closestToParkingDistance === null || distanceFromParking < closestToParkingDistance) {
            closestToParkingDistance = distanceFromParking;
            closestToParkingIdx = idx; 
        }
    });
    if (closestToParkingIdx === null)
        return null;

    return sections[closestToParkingIdx]!;
}