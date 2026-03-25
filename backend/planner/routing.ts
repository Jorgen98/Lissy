/*
 * File: routing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for routing and building a response to a trip request using the planner adapter.
 */

const dbPostgis = require('../db-postgis.js');

import { RoutePlanner } from "./RoutePlanner";
import { TripRequest } from "./types/TripRequest";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { calculateDistanceHaversine, getIntermediatePoint } from "./geo";
import { TripOption, TripSectionOption } from "./types/TripOption";
import { TransferHub } from "./types/TransferHub";
import { LatLng } from "./types/LatLng";
import { kmeans } from "ml-kmeans";
import { TicketType, UserPreferences } from "../../frontend/modules/planner/types/TripDataExtended";
import { EMISSION_FACTORS, IDS_JMK_FARE_SYSTEM, Ticket } from "./utils/criteriaConstants";
import { 
    WALKING_DISTANCE_COEF, 
    DRIVING_DISTANCE_COEF, 
    MIN_DRIVE_DISTANCE, 
    SCORE_STOP_RADIUS, 
    PARK_AND_RIDE_DECISION_SCORE, 
    PARK_AND_RIDE_DECISION_DISTANCE, 
    TRANSFER_HUB_SCORE, 
    TRANSFER_HUB_RADIUS_SHIFT,
    CANDIDATES_NO_CLUSTER_LIMIT,
    TRANSFER_HUB_MIN_IMPROVEMENT,
    CLUSTER_NUMBER_FACTOR,
} from "./utils/systemConstants";

// Trip routing entry point function
export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Perform possible initialization steps
    if (!await planner.initialize())
        return null;

    // Get list of trip options 
    const tripOptions = await getTripOptions(request, planner);
    if (tripOptions === null)
        return null;

    // Apply postprocessing operations to all trip options
    postprocessTripOptions(tripOptions, request);

    // Filter out unsatisfactory trip options by given user preferences
    return filterOptions(tripOptions, request.preferences);
}

// Function performing postprocessing operations on all of the found trip options
function postprocessTripOptions(options: TripOption[], request: TripRequest): void {
    options.forEach(option => {

        // Add place names to sections origins and destinations based on the data from trip request
        addPlaceNames(option, request);       
        
        // Add number of transfer in the trip option
        addNumberOfTransfers(option);
    });
}

// Function performing postprocessing operations on trip sections
function postprocessTripSections(options: TripSectionOption[], preferences: UserPreferences): void {
    options.forEach(option => {

        // Add cost information to sections
        addPricing(option, preferences.publicTransport.ticketType);

        // Add emission levels to sections
        addEmissions(option);
    });
}

// Function accumulating the prices of usage of all modes on the trip section
function addPricing(section: TripSectionOption, ticketType: TicketType): void {

    // Calculate the price of using public transport
    let sectionPrice = calculatePublicTransportPrice(section, ticketType);

    // TODO add car pricing

    // Adjust object
    section.cost = sectionPrice;
}

// Function calculating the price of using public transport on a single trip section
function calculatePublicTransportPrice(section: TripSectionOption, ticketType: TicketType): number {

    // Get first and last transit legs of the section
    const firstTransitLeg = section.legs.find(leg => leg.mode !== "WALK" && leg.mode !== "CAR");
    const lastTransitLeg = section.legs.findLast(leg => leg.mode !== "WALK" && leg.mode !== "CAR");
    if (!firstTransitLeg || !lastTransitLeg)
        return 0;

    // Get time when transit begins, and when it ends
    const transitStartTime = firstTransitLeg.from.departureTime;
    const transitEndTime = lastTransitLeg.to.arrivalTime;

    // Create a list of unique transport system zones used in the section
    const uniqueZones = new Set<string>();
    section.legs.forEach(leg => {
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
function addNumberOfTransfers(trip: TripOption): void {

    // Flatten the trip into a list of its legs
    const legs = trip.sections.flatMap(section => section.legs);

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
    trip.numTransfers = numTransfers;
}

// Function returning a list of TripOption objects
async function getTripOptions(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Get information from the trip request, for less access to the request object
    const { datetime, preferences, points, modes } = request;

    // The sections need to be built in reverse if arrival time is selected
    const reverseOrder = datetime.datetimeOption === "arrival";

    // Use the globally set modes for a trip that has no midpoints
    const useGlobalModes = points.length === 2;

    // Datetime that should be used as departure/arrival time for the next section
    let followingDatetime = datetime.tripDatetime;

    // Accumulators for total distance, duration, emissions and sections of the trip
    let totalDistance = 0;
    let totalDuration = 0;
    let totalEmissions = 0;
    const tripSections: TripSectionOption[] = []; 

    // Change the order of iteration based on the reverseOrder variable set earlier
    // Iterates the trip points from behind for trips that have latest arrival time selected
    for (
        let i = reverseOrder ? points.length - 1 : 0; 
        reverseOrder ? i > 0 : i < points.length - 1;
        reverseOrder ? i-- : i++
    ) {
        // Get modes to be used for this section 
        const sectionModes = useGlobalModes ? modes.global : modes.sections[reverseOrder ? i - 1 : i]!;

        // Get coordinates of the start and end points of the section
        const pointA = points[reverseOrder ? i - 1 : i]!;
        const pointB = points[reverseOrder ? i : i + 1]!;

        // Create request object for the section
        const sectionRequest: TripSectionInfo = {
            pointA,
            pointB,
            preferences,
            modes: sectionModes,
            datetime: {
                datetime: followingDatetime,
                option: datetime.datetimeOption,
            }
        }
        
        // Request options for this section with created request object
        const foundSections = await getSectionOptions(planner, sectionRequest);
        if (foundSections.length === 0)
            return null;

        // If its a trip request without midpoints, return all found section options wrapped in a TripOption object
        // Otherwise get only the first found section option 
        // TODO will be changed when ranking is introduced
        if (points.length === 2) {
            return foundSections.map(section => ({
                distance: section.distance,
                duration: section.duration,
                endDatetime: section.endDatetime,
                startDatetime: section.startDatetime,                
                hasFullShape: false,
                sections: [section],
                numTransfers: 0, // Calculated later
                emissions: section.emissions,
            }));
        }
        const section = foundSections[0]!;

        // Datetime of the next/previous section will be the ending/starting dateTime of the previous/next
        followingDatetime = (reverseOrder ? section.startDatetime : section.endDatetime).toISOString();

        // Accumulate distance, duration and sections in the right order
        reverseOrder ? tripSections.unshift(section) : tripSections.push(section);
        totalDistance += section.distance;
        totalDuration += section.duration;
        totalEmissions += section.emissions!;
    } 

    // Build final array of options
    // NOTE: Always one for now, will be changed when ranking is introduced
    const options = [{
        distance: totalDistance,
        duration: totalDuration,
        sections: tripSections,
        startDatetime: tripSections[0]!.startDatetime,
        endDatetime: tripSections[tripSections.length - 1]!.endDatetime,
        hasFullShape: false,
        numTransfers: 0, // Calculated later
        emissions: totalEmissions,
    }];

    // TODO rate full options and rank them in order of rating

    return options;
} 

// Function returning a list of TripSectionOption objects, which is a part of the trip, always between two points in the trip request
async function getSectionOptions(planner: RoutePlanner, request: TripSectionInfo): Promise<TripSectionOption[]> {

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

// Function finding all candidate transfer hubs between pointA and pointB for a car->transit section
async function getTransferHubs(pointA: LatLng, pointB: LatLng, distance: number): Promise<TransferHub[]> {

    // Find point along the line between A and B at (TRANSFER_HUB_RADIUS_SHIFT * distance) distance from point A
    const intermediatePoint = getIntermediatePoint(pointA, pointB, TRANSFER_HUB_RADIUS_SHIFT, distance);

    // Get stations that are in a given radius around this intermediate point, have a good enough score and parking nearby
    const candidateHubs = await dbPostgis
        .getNearbyStations(intermediatePoint.lat, intermediatePoint.lng, distance / 2, TRANSFER_HUB_SCORE, true);

    // Convert response into list of candidate stations with their coordinates, nearest parking coordinates, scores and name
    return (Object.values(candidateHubs) as { 
        latLng: [number, number], 
        parkingLatLng: [number, number], 
        transit_score: number, 
        stop_name: string
    }[]).map(hub => ({
        coords: { lat: hub.latLng[0], lng: hub.latLng[1] },
        parkingCoords: { lat: hub.parkingLatLng[0], lng: hub.parkingLatLng[1] },
        score: hub.transit_score,
        name: hub.stop_name,
    }));
}

// Function getting the transit score of an arbitrary point 
async function getPointTransitAccessScore(coords: LatLng): Promise<number> {

    // Find stations that are in a given radius from the point
    const nearbyStations = await dbPostgis.getNearbyStations(coords.lat, coords.lng, SCORE_STOP_RADIUS);

    // Find the maximum score from the nearby stops
    let maxScore = 0;
    for (const data of Object.values(nearbyStations) as any) {
        const stationScore = data.transit_score as number;
        if (stationScore > maxScore)
            maxScore = stationScore;
    }

    return maxScore;
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

// Function clustering the candidate transfer hubs when there are more of them than the threshold using Kmeans 
// Returns the best scored representative from each cluster, if clustering is actually necessary
function clusterHubs(hubs: TransferHub[]): TransferHub[] {

    // If the number of hubs is less than the threshold, dont cluster
    if (hubs.length <= CANDIDATES_NO_CLUSTER_LIMIT)
        return hubs;

    // Create valid array of lat/lng tuples, needed for kmeans
    const coords = hubs.map(hub => [hub.coords.lat, hub.coords.lng]);
    
    // Calculate number of clusters with a base constant and a slow growing factor (numHubs^factor)
    const numClusters = CANDIDATES_NO_CLUSTER_LIMIT + Math.floor(Math.pow(hubs.length, CLUSTER_NUMBER_FACTOR));

    // Run KMeans for the array of coordinates with custom distance function (straight line distance between points on globe)
    const kmeansResult = kmeans(coords, numClusters, {
        distanceFunction: (a, b) => calculateDistanceHaversine(
            { lat: a[0]!, lng: a[1]! }, 
            { lat: b[0]!, lng: b[1]! }
        )
    });

    // Map the result of kmeans cluster back to the hubs
    const hubsWithClusters = hubs.map((hub, idx) => ({
        ...hub,
        cluster: kmeansResult.clusters[idx]!
    }));

    // Create dictionary mapping cluster number to hubs in the cluster with that number
    const clusterToHubs: Record<number, TransferHub[]> = {};
    hubsWithClusters.forEach(hub => {
        if (clusterToHubs[hub.cluster] === undefined)
            clusterToHubs[hub.cluster] = [hub]
        else
            clusterToHubs[hub.cluster]!.push(hub);
    });

    // Select the best scored representative from each cluster and return them in a list
    return Object.values(clusterToHubs).map(hubCluster => {
        let bestHub: TransferHub = hubCluster[0]!;
        hubCluster.forEach(hub => {
            if (hub.score > bestHub.score)
                bestHub = hub;
        });

        return bestHub;
    });
}

// Function filtering the candidate transfer hubs based on origin and destination scores and distance
async function filterTransferHubs(candidates: TransferHub[], origin: LatLng, destination: LatLng): Promise<TransferHub[]> {

    // Get transit access scores of both the destination and origin points
    const originScore = await getPointTransitAccessScore(origin);
    const destinationScore = await getPointTransitAccessScore(destination);

    // If they both have good access to public transport, dont request the combined leg
    if (originScore >= PARK_AND_RIDE_DECISION_SCORE && destinationScore >= PARK_AND_RIDE_DECISION_SCORE)
        return [];

    // If they both have not great access to public transport, use only hubs that actually improve on both of them
    if (originScore < PARK_AND_RIDE_DECISION_SCORE && destinationScore < PARK_AND_RIDE_DECISION_SCORE) {
        const worseScore = Math.min(originScore, destinationScore);
        return candidates.filter(candidate => candidate.score >= worseScore + TRANSFER_HUB_MIN_IMPROVEMENT);
    }

    // If origin has good transit access and destionation does not, find hubs that improve on destinationScore and are closer to destination than origin
    else if (originScore >= PARK_AND_RIDE_DECISION_SCORE && destinationScore < PARK_AND_RIDE_DECISION_SCORE) {
        return candidates.filter(candidate => {
            const distToOrigin = calculateDistanceHaversine(origin, candidate.coords);
            const distToDestination = calculateDistanceHaversine(candidate.coords, destination);

            return distToDestination < distToOrigin && candidate.score > destinationScore;
        });
    }

    return candidates;
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

// Function filtering the plain list of found trip options
function filterOptions(options: TripOption[], preferences: UserPreferences): TripOption[] {

    // Get values from request object
    const maxWalkDistance = preferences.walk.maxDistance;
    const maxTransfers = preferences.publicTransport.maxTransfers;

    // Run each trip options through filters
    return options.filter(option => {

        // Filter out options with legs longer then maximum set walking distance
        if (maxWalkDistance !== null) {
            for (const section of option.sections) {
                for (const leg of section.legs) {
                    if (leg.mode === "WALK" && leg.distance > maxWalkDistance)
                        return false;
                }
            }
        }

        // Filter out options with number of transfers higher than maximum set in user settings
        if (maxTransfers !== null) {
            if (option.numTransfers > maxTransfers)
                return false;
        }
        
        // Option passed all filters
        return true;
    });
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