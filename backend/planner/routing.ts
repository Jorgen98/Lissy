/*
 * File: routing.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Function for routing and building a response to a trip request using the planner adapter.
 */

const dbPostgis = require('../db-postgis.js');

import { TransportMode } from "../../frontend/modules/planner/types/TransportMode";
import { RoutePlanner } from "./RoutePlanner";
import { TripRequest } from "./types/TripRequest";
import { TripSectionInfo } from "./types/TripSectionInfo";
import { calculateDistanceHaversine, getIntermediatePoint } from "./geo";
import { TripOption, TripSectionOption } from "./types/TripOption";
import { TransferHub } from "./types/TransferHub";
import { LatLng } from "./types/LatLng";
import { kmeans } from "ml-kmeans";
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
} from "./utils/coefficients";

// Trip routing entry point function
export async function planTrip(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // Perform possible initialization steps
    if (!await planner.initialize())
        return null;

    // Call planning function based on number of trip points
    let tripOptions: TripOption[] | null = [];
    if (request.points.length === 2)
        tripOptions = await planTripWithoutMidpoints(request, planner);
    else 
        tripOptions = await planTripWithMidpoints(request, planner);
    if (tripOptions === null)
        return null;

    // Add place names to sections origins and destinations based on the data from trip request
    addPlaceNames(tripOptions, request);

    return tripOptions;
}

async function planTripWithMidpoints(request: TripRequest, planner: RoutePlanner): Promise<TripOption[] | null> {

    // The sections need to be built in reverse if arrival time is selected
    const reverseOrder = request.datetime.datetimeOption === "arrival";

    // Datetime that should be used as departure/arrival time for the next section
    let followingDatetime = request.datetime.tripDatetime;

    // Accumulators for total distance, duration and sections of the trip
    let totalDistance = 0;
    let totalDuration = 0;
    let tripSections: TripSectionOption[] = []; 

    for (
        let i = reverseOrder ? request.points.length - 1 : 0; 
        reverseOrder ? i > 0 : i < request.points.length - 1;
        reverseOrder ? i-- : i++
    ) {

        // Get modes selected to be used for this section 
        const sectionModes = request.modes.sections[reverseOrder ? i - 1 : i]!;

        // Get coordinates of the start and end points of the section
        const pointA = request.points[reverseOrder ? i - 1 : i]!;
        const pointB = request.points[reverseOrder ? i : i + 1]!;

        // Get one mode selected for this section
        // NOTE: Always just one for now
        const selectedMode = Object.keys(sectionModes)
            .find(mode => sectionModes[mode as TransportMode]) as TransportMode;

        // Call OTP service to get one option with given parameters 
        // NOTE: Always just one for now
        const foundSections = await planner
            .getTripSection(
                createSectionRequest(request, pointA, pointB, [selectedMode], followingDatetime), 1
            );    
        if (!foundSections || foundSections[0] === undefined)
            return null;
        const section = foundSections[0];

        // Datetime of the next/previous section will be the ending/starting dateTime of the previous/next
        followingDatetime = (reverseOrder ? section.startDatetime : section.endDatetime).toISOString();

        // Accumulate distance, duration and sections in the right order
        reverseOrder ? tripSections.unshift(section) : tripSections.push(section);
        totalDistance += section.distance;
        totalDuration += section.duration;
    } 

    // Build final array of options
    // NOTE: Always one for now
    const options = [{
        distance: totalDistance,
        duration: totalDuration,
        sections: tripSections,
        startDatetime: tripSections[0]!.startDatetime,
        endDatetime: tripSections[tripSections.length - 1]!.endDatetime,
    }];

    // Filter out unsatisfactory trip options by request parameters
    return filterOptions(options, request);
} 

async function planTripWithoutMidpoints(request: TripRequest, planner: RoutePlanner): Promise<TripOption[]> {

    // Get modes used in request for less object access
    const globalModes = request.modes.global;

    // List of promises from requests to the planner so Promise.all can be used
    const plannerRequests: Promise<TripSectionOption[] | null>[] = []; 

    const origin = request.points[0]!;
    const destination = request.points[1]!;

    // Always get trip options with public transport section if selected
    if (globalModes.publicTransport) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(
                    request, 
                    origin, 
                    destination, 
                    ["publicTransport"], 
                    request.datetime.tripDatetime
                )
            )
        );
    }

    // If only one direct mode (car or walk) is selected, get trip sections for that mode
    if ((globalModes.car && !globalModes.walk) || (!globalModes.car && globalModes.walk)) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(
                    request, 
                    origin, 
                    destination, 
                    [globalModes.car ? "car" : "walk"], 
                    request.datetime.tripDatetime
                )
            )
        );
    }

    // If both direct modes (car and walk) are selected, decide on point distance (straight line) if they both make sense
    if (globalModes.car && globalModes.walk)
        carWalkCombination(request, plannerRequests, planner);

    // If car and public trasnport are both selected, decide if a CAR->transfer->TRANSIT options should be requested
    if (globalModes.publicTransport && globalModes.car) {
        const carTransitRequests = await carTransitCombination(request, planner);
        plannerRequests.push(...carTransitRequests);
    };

    // Wait for all created requests running in parallel
    const results = await Promise.all(plannerRequests);

    // Filter out unsuccessful requests and flatten the 2D list returned by Promise.all into one 1D list with all options
    const foundOptions = results.filter(result => result !== null).flat();

    // Deduplicate public transport options that have the same legs as another option, which departs earlier/later (depending on departure or arrival time)
    const deduplicatedOptions = deduplicateOptions(foundOptions, request.datetime.datetimeOption === "arrival");

    // Flatten the filtered 2D list into one 1D list of TripOptions
    const tripOptions = deduplicatedOptions.map(option => ({
        distance: option.distance,
        duration: option.duration,
        endDatetime: option.endDatetime,
        sections: [option], // Simply a trip option with one section
        startDatetime: option.startDatetime
    }));

    // Filter out unsatisfactory trip options by request parameters
    const filteredOptions = filterOptions(tripOptions, request);

    // TODO Rank options

    return filteredOptions;
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
function deduplicateOptions(options: TripSectionOption[], reverseOrder: boolean): TripSectionOption[] {

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
async function carTransitCombination(request: TripRequest, planner: RoutePlanner): Promise<Promise<TripSectionOption[] | null>[]> {

    // Get origin and destination points from the original request
    const origin = request.points[0]!;
    const destination = request.points[1]!;

    // Get straight line distance between the two points, check if its not too short for car->transit
    const distance = calculateDistanceHaversine(origin, destination);
    if (distance < PARK_AND_RIDE_DECISION_DISTANCE)
        return [];

    // Find candidate transit hubs for the two points, dont make request if none are found
    const candidateHubs = await getTransferHubs(origin, destination, distance);

    // Filter the transfer hubs based on scores of origin and destination
    const filteredHubs = await filterTransferHubs(candidateHubs, origin, destination);

    // Cluster hubs if theres more of them than the threshold using KMeans
    const clusteredHubs = clusterHubs(filteredHubs);

    // Create list of Promise objects and return it so it can be processed concurrently
    return clusteredHubs.map(hub => buildCarTransitTrip(request, planner, origin, hub, destination));
}

// Function clustering the candidate transfer hubs when there are more of them than the threshold using Kmeans 
// Returns the best scored representative from each cluster
function clusterHubs(hubs: TransferHub[]): TransferHub[] {

    // If the number of hubs is less than the threshold, dont cluster
    if (hubs.length <= CANDIDATES_NO_CLUSTER_LIMIT)
        return hubs;

    // Create valid array of lat lng tuples, needed for kmeans
    const coords = hubs.map(hub => [hub.coords.lat, hub.coords.lng]);
    
    // Calculate number of cluster with a base and a slow growing factor
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

    // Create dictionary mapping cluster number to clustered hubs
    const clusterToHubs: Record<number, TransferHub[]> = {};
    hubsWithClusters.forEach(hub => {
        if (clusterToHubs[hub.cluster] === undefined)
            clusterToHubs[hub.cluster] = [hub]
        else
            clusterToHubs[hub.cluster]!.push(hub);
    });

    // Select the best scored representative from each cluster
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
async function buildCarTransitTrip(
    request: TripRequest,
    planner: RoutePlanner,
    origin: LatLng, 
    transfer: TransferHub, 
    destination: LatLng
): Promise<TripSectionOption[] | null> {

    // Get list of car legs that terminate at the nearest parking spot (most likely always one)
    const carLegs = await planner.getTripSection(
        createSectionRequest(request, origin, transfer.parkingCoords, ["car"], request.datetime.tripDatetime)
    );
    if (carLegs === null || carLegs.length === 0)
        return null;

    // Get first car leg, most likely there will only be one anyway
    const firstCarLeg = carLegs[0]!;

    // Get arrival time of the car leg
    const carLegArrival = firstCarLeg.endDatetime.toISOString();  

    // Get list of transit options from the transfer point parking lot
    const transitOptions = await planner.getTripSection(
        createSectionRequest(request, transfer.parkingCoords, destination, ["publicTransport"], carLegArrival)
    );
    if (transitOptions === null || transitOptions.length === 0)
        return null;

    // Use only options that actually do start at the wanted hub, since the planner service could return options that access to some other station
    const validTransitOptions = transitOptions.filter(option => {

        // Get first transit leg in the section option
        const firstTransitLeg = option.legs.find(leg => leg.mode !== "WALK" && leg.mode !== "CAR");
        if (firstTransitLeg === undefined)
            return false;

        // Check if the name of the origion of the first transit leg matches the transfer hub name
        return firstTransitLeg.from.placeName === transfer.name;
    });
    if (validTransitOptions.length === 0)
        return [];

    // Get first transit option
    // TODO use a few of them (ranking)
    const firstTransitOption = validTransitOptions[0]!;

    // Update the transit section object with data from the car leg object
    firstTransitOption.distance += firstCarLeg.distance;
    firstTransitOption.duration += firstCarLeg.duration;
    firstTransitOption.originName = firstCarLeg.originName;
    firstTransitOption.startDatetime = firstCarLeg.startDatetime;
    firstTransitOption.legs.unshift(firstCarLeg.legs[0]!);

    // Return one option for now
    return [firstTransitOption];
}

function carWalkCombination(request: TripRequest, plannerRequests: Promise<TripSectionOption[] | null>[], planner: RoutePlanner): void {

    // Get straight line distance between the two points using haversine function
    const distance = calculateDistanceHaversine(request.points[0]!, request.points[1]!);

    // Get driving distance and walking distance estimates
    // TODO play around with coefficients
    const driveDistEstimate = distance * DRIVING_DISTANCE_COEF;
    const walkDistEstimate = distance * WALKING_DISTANCE_COEF;

    // If the maximum walking distance is more than the estimate or not limited, create a walk request for the section
    if (request.preferences.walk.maxDistance === null || walkDistEstimate <= request.preferences.walk.maxDistance) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(request, request.points[0]!, request.points[1]!, ["walk"], request.datetime.tripDatetime)
            )
        );
    }

    // If the distance is too short, it might not make sense to get car options
    // TODO decide on correct threshold
    if (driveDistEstimate > MIN_DRIVE_DISTANCE) {
        plannerRequests.push(
            planner.getTripSection(
                createSectionRequest(request, request.points[0]!, request.points[1]!, ["car"], request.datetime.tripDatetime)
            )
        );
    }
}

// Function filtering the plain list of found options
function filterOptions(options: TripOption[], request: TripRequest): TripOption[] {

    // Get maximum walking distance from request object
    const maxWalkDistance = request.preferences.walk.maxDistance;

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
        
        // Option passed all filters
        return true;
    });
} 

// Function adding place names to section origin points and destination points where they arent yet set
function addPlaceNames(options: TripOption[], request: TripRequest): void {

    // Go through each section
    options.forEach(option => {
        option.sections.forEach((section, index) => {
            
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
    });
}

// Function creating the section request object for the planner adapter
function createSectionRequest(
    request: TripRequest,
    pointA: LatLng, 
    pointB: LatLng, 
    modes: TransportMode[], 
    datetime: string 
): TripSectionInfo {
    return {
        pointA,
        pointB,
        modes: modes,
        datetime: {
            option: request.datetime.datetimeOption,
            datetime
        },
        preferences: {
            walk: {
                speed: request.preferences.walk.avgSpeed,
            },
            publicTransport: {
                allowedModes: request.preferences.publicTransport.allowedModes
            }
        }
    }
}