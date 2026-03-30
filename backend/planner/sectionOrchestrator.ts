/*
 * File: sectionOrchestrator.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for handling the requesting, building and filtering individual trip sections.
 */

import { RoutePlanner } from "./RoutePlanner";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { TripSectionOption } from "./types/TripOption";
import { postprocessTripSections, rateOptions } from "./postprocessing";
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

    // Get groups of requests that are executed concurrently with Promise.all
    const sectionRequestGroups = getRequestGroups(request, planner);

    // Wait for all request groups to finish, filter out unsuccesfull requests and flatten to 1D array of TripSectionOption
    const foundSections = (await Promise.all(sectionRequestGroups))
        .filter(group => group !== null)
        .flat();

    // Deduplicate public transport options that have the same legs as another option, which departs earlier/later (depending on departure or arrival time)
    const deduplicatedSections = deduplicateSections(foundSections, request.datetime.option === "arrival");

    // Apply postprocessing operations to found options, calculates other useful data for the section
    await postprocessTripSections(deduplicatedSections, request.preferences);

    // Rate the found sections
    rateOptions(deduplicatedSections);

    // Sort the options by calculated rating
    deduplicatedSections.sort((a, b) => b.score! - a.score!);
    
    return deduplicatedSections;
}

// Function building requests based on the selected modes for the section
function getRequestGroups(request: TripSectionInfo, planner: RoutePlanner): Promise<TripSectionOption[] | null>[] {
    const modes = request.modes;

    // If the number of selected modes is exactly one, request trips for that mode
    if (Number(modes.walk) + Number(modes.car) + Number(modes.publicTransport) === 1)  
        return [planner.getTripSection({ ...request, modes })];

    // If only walk and car are seleced, call function that decides if both request should be made based on distance 
    if (modes.walk && modes.car && !modes.publicTransport)                                  
        return [carWalkCombination(planner, request)];

    // If only walk and public transport are chosen, make both requests
    if (modes.walk && !modes.car && modes.publicTransport) {
        return [
            planner.getTripSection({ ...request, modes: { walk: true, car: false, publicTransport: false }}),
            planner.getTripSection({ ...request, modes: { walk: false, car: false, publicTransport: true }}),
        ];
    }

    // If only car and public transport are chosen, request pure public transport options, and car->transit options
    if (!modes.walk && modes.car && modes.publicTransport) {
        return [
            carTransitCombination(planner, request),
            planner.getTripSection({ ...request, modes: { walk: false, car: false, publicTransport: true }}),
        ];
    }

    // If all options are selected, request pure public transport, car->transit, and a walk section
    return [
        carTransitCombination(planner, request),
        planner.getTripSection({ ...request, modes: { walk: false, car: false, publicTransport: true }}),
        planner.getTripSection({ ...request, modes: { walk: true, car: false, publicTransport: false }}),
    ];
}

// Function handling the combination of car and public transport in one request
async function carTransitCombination(planner: RoutePlanner, request: TripSectionInfo): Promise<TripSectionOption[]> {

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

    // Maximum of two sequential requests for each transfer hub
    const requests = clusteredHubs.map(hub => buildCarTransitTrip(planner, request, hub)); 

    // Wait for all requests to finish and flatten into an array of section options with car and transit combined
    return (await Promise.all(requests)).flat();
}

// Function building a trip section option/options that transfers from car to transit at 'transfer'
async function buildCarTransitTrip(planner: RoutePlanner, request: TripSectionInfo, transfer: TransferHub): Promise<TripSectionOption[]> {

    // Get list of car legs that terminate at the nearest parking spot (most likely always one)
    const carOptions = await planner.getTripSection({ 
        ...request, 
        pointB: transfer.parkingCoords, 
        modes: { car: true, publicTransport: false, walk: false } 
    });
    if (carOptions === null || carOptions.length === 0)
        return [];

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
        return [];

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
    
    // Since the car is fetched first and only then transit trips are queried, a gap is going to get created between the car leg arrival and transit leg departure
    // This gap isnt necessary, since the car can just leave later and match up exactly to the departure of the transit leg
    // These three lines shift the arrival of the car leg to the departure of the transit leg, whilst also shifting the car leg departure, since the duration is already known
    const carSectionIdealStart = firstTransitOption.startDatetime.getTime() - carSection.duration * 1000;
    carSection.startDatetime = new Date(carSectionIdealStart);
    carSection.endDatetime = firstTransitOption.startDatetime;

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
async function carWalkCombination(planner: RoutePlanner, request: TripSectionInfo): Promise<TripSectionOption[]> {

    const origin = request.pointA;
    const destination = request.pointB;
    const walkPreferences = request.preferences.walk;

    // Get straight line distance between the two points using haversine function
    const distance = calculateDistanceHaversine(origin, destination);

    // Get driving distance and walking distance estimates
    const driveDistEstimate = distance * DRIVING_DISTANCE_COEF;
    const walkDistEstimate = distance * WALKING_DISTANCE_COEF;

    // List of promises for created requests
    const requests: Promise<TripSectionOption[] | null>[] = [];

    // If the maximum walking distance is more than the estimate or not limited, create a walk request for the section
    if (walkPreferences.maxDistance === null || walkDistEstimate <= walkPreferences.maxDistance)
        requests.push(planner.getTripSection({ ...request, modes: { publicTransport: false, car: false, walk: true }}));

    // If the distance is too short, it might not make sense to get car options
    if (driveDistEstimate > MIN_DRIVE_DISTANCE)
        requests.push(planner.getTripSection({ ...request, modes: { publicTransport: false, car: true, walk: false }}));

    // Wait for (both) requests to finish, filter out failed and flatten to 1D array
    return (await Promise.all(requests)).filter(res => res !== null).flat();
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