/*
 * File: geo.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Geographic functions.
 */


// Function using the haversine formula to calculate straight line distance between two points in meters
export function calculateDistanceHaversine(pointA: { lat: number, lng: number }, pointB: { lat: number, lng: number }): number {

    // Earth radius (meters)
    const r = 6_371_000;

    // Convert lat/lng degrees to radians
    const pointALat = pointA.lat * Math.PI / 180;
    const pointBLat = pointB.lat * Math.PI / 180;
    const latDelta = (pointB.lat - pointA.lat) * Math.PI / 180;
    const lngDelta = (pointB.lng - pointA.lng) * Math.PI / 180;

    // Calculate haversine of omega (central angle between the two points on a sphere)
    const cos = Math.cos;
    const havOmega = (1 - cos(latDelta) + cos(pointALat) * cos(pointBLat) * (1 - cos(lngDelta))) / 2;

    // Calculate central angle between the two points on a sphere
    const omega = 2 * Math.asin(Math.sqrt(havOmega));

    // Calculate distance between two points in meters
    return r * omega;
}