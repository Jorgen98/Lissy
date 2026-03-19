/*
 * File: coefficients.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Definitions and descriptions of coefficients/constants use during routing for different purposes.
 */

// Multiplying coefficients used for approximating walking/driving distance from straight line distance
export const DRIVING_DISTANCE_COEF = 1.4;
export const WALKING_DISTANCE_COEF = 1.2;

// Minimum driving distance where it might make sense to use the car instead of walking in meters
export const MIN_DRIVE_DISTANCE = 1500;

// Radius to look for nearby stops in for scoring of an arbitrary point
export const SCORE_STOP_RADIUS = 1000;

// If a point has a higher score than this constant, it is considered to have good enough access to public transport
// that a car->transit trip may not be warranted
export const PARK_AND_RIDE_DECISION_SCORE = 75;

// If the distance between two points is more than this constant, park and ride is always considered
export const PARK_AND_RIDE_DECISION_DISTANCE = 5000;