/*
 * File: transferHubs.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Functions for work with transfer hubs that are used in car->transit trip sections.
 */

const dbPostgis = require("../db-postgis.js");

import { getIntermediatePoint, calculateDistanceHaversine } from "./geo";
import { TransferHub } from "./types/TransferHub";
import { LatLng } from "./types/LatLng";
import { kmeans } from "ml-kmeans";
import { plannerConfig } from "./tripOrchestrator";
import { 
    TRANSFER_HUB_RADIUS_SHIFT, 
    SCORE_STOP_RADIUS,
    CANDIDATES_NO_CLUSTER_LIMIT,
} from "./utils/systemConstants";

// Function finding all candidate transfer hubs between pointA and pointB for a car->transit section
export async function getTransferHubs(pointA: LatLng, pointB: LatLng, distance: number): Promise<TransferHub[]> {

    // Find point along the line between A and B at (TRANSFER_HUB_RADIUS_SHIFT * distance) distance from point A
    const intermediatePoint = getIntermediatePoint(pointA, pointB, TRANSFER_HUB_RADIUS_SHIFT, distance);

    // Get stations that are in a given radius around this intermediate point, have a good enough score and parking nearby
    const candidateHubs = await dbPostgis
        .getNearbyStations(intermediatePoint.lat, intermediatePoint.lng, distance / 2, plannerConfig!.transfer_hub_score, true);

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

// Function clustering the candidate transfer hubs when there are more of them than the threshold using Kmeans 
// Returns the best scored representative from each cluster, if clustering is actually necessary
export function clusterHubs(hubs: TransferHub[]): TransferHub[] {

    // If the number of hubs is less than the threshold, dont cluster
    if (hubs.length <= CANDIDATES_NO_CLUSTER_LIMIT)
        return hubs;

    // Create valid array of lat/lng tuples, needed for kmeans
    const coords = hubs.map(hub => [hub.coords.lat, hub.coords.lng]);
    
    // Calculate number of clusters with a base constant and a slow growing factor (numHubs^factor)
    const numClusters = Math.min(hubs.length, CANDIDATES_NO_CLUSTER_LIMIT + Math.floor(Math.pow(hubs.length, parseFloat(plannerConfig!.clustering_factor))));

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
export async function filterTransferHubs(candidates: TransferHub[], origin: LatLng, destination: LatLng): Promise<TransferHub[]> {

    // Get transit access scores of both the destination and origin points
    const originScore = await getPointTransitAccessScore(origin);
    const destinationScore = await getPointTransitAccessScore(destination);

    // If they both have good access to public transport, dont request the combined leg
    if (originScore >= plannerConfig!.park_and_ride_decision_score && destinationScore >= plannerConfig!.park_and_ride_decision_score)
        return [];

    // If they both have not great access to public transport, use only hubs that actually improve on both of them
    if (originScore < plannerConfig!.park_and_ride_decision_score && destinationScore < plannerConfig!.park_and_ride_decision_score) {
        const worseScore = Math.min(originScore, destinationScore);
        return candidates.filter(candidate => candidate.score >= worseScore + plannerConfig!.transfer_hub_min_improvement);
    }

    // If origin has good transit access and destionation does not, find hubs that improve on destinationScore and are closer to destination than origin
    else if (originScore >= plannerConfig!.park_and_ride_decision_score && destinationScore < plannerConfig!.park_and_ride_decision_score) {
        return candidates.filter(candidate => {
            const distToOrigin = calculateDistanceHaversine(origin, candidate.coords);
            const distToDestination = calculateDistanceHaversine(candidate.coords, destination);

            return distToDestination < distToOrigin && candidate.score > destinationScore;
        });
    }

    return candidates;
}