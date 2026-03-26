/*
 * File: sectionOrchestrator.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for handling the requesting, building and filtering individual trip sections.
 */

import { RoutePlanner } from "./RoutePlanner";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { TripSectionOption } from "./types/TripOption";
import { postprocessTripSections } from "./postprocessing";
import { calculateDistanceHaversine } from "./geo";
import { getTransferHubs, filterTransferHubs, clusterHubs } from "./transferHubs";
import { TransferHub } from "./types/TransferHub";
import { 
    PARK_AND_RIDE_DECISION_DISTANCE, 
    MIN_DRIVE_DISTANCE,
    WALKING_DISTANCE_COEF,
    DRIVING_DISTANCE_COEF
} from "./utils/systemConstants";

// Function returning a list of TripSectionOption objects, which is a part of the trip, always between two points in the trip request
export async function getSectionOptions(planner: RoutePlanner, request: TripSectionInfo): Promise<TripSectionOption[]> {

    // List of promises from requests to the planner so Promise.all can be used
    const plannerRequests: Promise<TripSectionOption[] | null>[] = []; 

    // Modes to be used for this section
    const modes = request.modes;

    // Always get trip options with public transport section if selected
    if (modes.publicTransport)
        plannerRequests.push(planner.getTripSection({ ...request, modes: { publicTransport: true, car: false, walk: false }}));

    // If only one direct mode (car or walk) is selected, get trip sections for that mode
    if ((modes.car && !modes.walk) || (!modes.car && modes.walk))
        plannerRequests.push(planner.getTripSection({ ...request, modes: { ...modes, publicTransport: false }}));

    // If both direct modes (car and walk) are selected, call function that handles this combination and creates requests
    if (modes.car && modes.walk)
        carWalkCombination(planner, request, plannerRequests);

    // If car and public transport are both selected, decide if CAR->transfer_hub->TRANSIT options should be requested
    if (modes.publicTransport && modes.car) {
        const carTransitRequests = await carTransitCombination(planner, request);
        plannerRequests.push(...carTransitRequests);
    };

    // Wait for all created requests running in parallel
    const results = await Promise.all(plannerRequests);

    // Filter out unsuccessful requests and flatten the 2D list returned by Promise.all into one 1D list with all options
    const foundSections = results.filter(result => result !== null).flat();

    // Deduplicate public transport options that have the same legs as another option, which departs earlier/later (depending on departure or arrival time)
    const deduplicatedSections = deduplicateSections(foundSections, request.datetime.option === "arrival");

    // Apply postprocessing operations to found options, calculates other useful data for the section
    postprocessTripSections(deduplicatedSections, request.preferences);

    // TODO rate the section options and return them in order by rating
    
    return deduplicatedSections;
}

// Function handling the combination of car and public transport in one request
async function carTransitCombination(planner: RoutePlanner, request: TripSectionInfo): Promise<Promise<TripSectionOption[] | null>[]> {

    // Get origin and destination point of the section
    const origin = request.pointA;
    const destination = request.pointB;

    // Get straight line distance between the two points, check if its not too short for car->transit
    const distance = calculateDistanceHaversine(origin, destination);
    if (distance < PARK_AND_RIDE_DECISION_DISTANCE)
        return [];

    // Find candidate transit hubs for the two points
    const candidateHubs = await getTransferHubs(origin, destination, distance);

    // Filter the transfer hubs based on scores of origin and destination
    const filteredHubs = await filterTransferHubs(candidateHubs, origin, destination);

    // Cluster hubs if theres more of them than the threshold using KMeans
    const clusteredHubs = clusterHubs(filteredHubs);

    // Create list of Promise objects and return it so it can be processed concurrently
    return clusteredHubs.map(hub => buildCarTransitTrip(planner, request, hub));
}

// Function building a trip section option/options that transfers from car to transit at 'transfer'
async function buildCarTransitTrip(planner: RoutePlanner, request: TripSectionInfo, transfer: TransferHub): Promise<TripSectionOption[] | null> {

    // Get list of car legs that terminate at the nearest parking spot (most likely always one)
    const carOptions = await planner.getTripSection({ 
        ...request, 
        pointB: transfer.parkingCoords, 
        modes: { car: true, publicTransport: false, walk: false } 
    });
    if (carOptions === null || carOptions.length === 0)
        return null;

    // Get first car leg, most likely there will only be one anyway
    const carSection = carOptions[0]!;

    // Get arrival time of the car leg
    const carLegArrival = carSection.endDatetime.toISOString();  

    // Get list of transit options from the transfer point parking lot
    const transitOptions = await planner.getTripSection({ 
        ...request, 
        pointA: transfer.parkingCoords, 
        modes: { car: false, publicTransport: true, walk: false },
        datetime: { datetime: carLegArrival, option: request.datetime.option }
    });
    if (transitOptions === null || transitOptions.length === 0)
        return null;

    // Use only options that actually do start at the wanted hub, since the planner service could return options that access to some other station
    const validTransitOptions = transitOptions.filter(option => {

        // Get first transit leg in the section option
        const firstTransitLeg = option.legs.find(leg => leg.mode !== "WALK" && leg.mode !== "CAR");
        if (firstTransitLeg === undefined)
            return false;

        // Check if the name of the origin of the first transit leg matches the transfer hub name
        return firstTransitLeg.from.placeName === transfer.name;
    });
    if (validTransitOptions.length === 0)
        return [];

    // Get first transit option
    // TODO use a few of them (ranking)
    const firstTransitOption = validTransitOptions[0]!;

    // Destination of the car leg is a parking spot
    carSection.legs[0]!.to.isParking = true;

    // Set the destination name of the car leg to the name of the transfer point (if it hasnt already been set earlier)
    if (carSection.legs[0]!.to.placeName === null)
        carSection.legs[0]!.to.placeName = transfer.name;

    // Update the transit section object with data from the car leg object
    firstTransitOption.distance += carSection.distance;
    firstTransitOption.duration += carSection.duration;
    firstTransitOption.originName = carSection.originName;
    firstTransitOption.startDatetime = carSection.startDatetime;
    firstTransitOption.legs.unshift(carSection.legs[0]!);

    // Return one option for now
    return [firstTransitOption];
}

// Function handling the combination of car and walking in one trip section
function carWalkCombination(planner: RoutePlanner, request: TripSectionInfo, plannerRequests: Promise<TripSectionOption[] | null>[]): void {

    const origin = request.pointA;
    const destination = request.pointB;
    const walkPreferences = request.preferences.walk;

    // Get straight line distance between the two points using haversine function
    const distance = calculateDistanceHaversine(origin, destination);

    // Get driving distance and walking distance estimates
    const driveDistEstimate = distance * DRIVING_DISTANCE_COEF;
    const walkDistEstimate = distance * WALKING_DISTANCE_COEF;

    // If the maximum walking distance is more than the estimate or not limited, create a walk request for the section
    if (walkPreferences.maxDistance === null || walkDistEstimate <= walkPreferences.maxDistance)
        plannerRequests.push(planner.getTripSection({ ...request, modes: { publicTransport: false, car: false, walk: true }}));

    // If the distance is too short, it might not make sense to get car options
    if (driveDistEstimate > MIN_DRIVE_DISTANCE)
        plannerRequests.push(planner.getTripSection({ ...request, modes: { publicTransport: false, car: true, walk: false }}));
}

// Function filtering public transport section options that are the same as another option but departure is later/earlier (depending on departure or arrival time selection)
function deduplicateSections(options: TripSectionOption[], reverseOrder: boolean): TripSectionOption[] {

    // Sort the options by departure time ascending if using departure time or by arrival time descending if using arrival time
    const optionsSorted = !reverseOrder ? 
        options.sort((a, b) => a.startDatetime.getTime() - b.startDatetime.getTime()) :
        options.sort((a, b) => b.endDatetime.getTime() - a.endDatetime.getTime());

    // Accumulator for section identifiers that have already been seen
    let seen = new Set<string>();

    // Accumulate and check seen ids for every option
    return optionsSorted.filter(option => {
        const id = buildSectionOptionId(option);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

// Function creating an id that is unique to sections that have the same legs
function buildSectionOptionId(option: TripSectionOption): string {

    // Start with distance and duration of the option
    let id = `${String(Math.round(option.distance))}_${String(Math.round(option.duration))}`;

    // Append information about each leg to the string
    option.legs.forEach(leg => {
        id += `_${leg.mode}_${Math.round(leg.distance)}_${Math.round(leg.duration)}_${leg.from.placeName}_${leg.to.placeName}`;
    });

    return id;
}