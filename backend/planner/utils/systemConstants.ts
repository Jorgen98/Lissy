/*
 * File: systemConstants.ts
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

// Score of a station needed for it to be considered a transfer hub for car->transit trip section
export const TRANSFER_HUB_SCORE = 60;

// The fraction used in getTransferHubs function which shifts the center of the radius along a line between two points 
export const TRANSFER_HUB_RADIUS_SHIFT = 0.4;

// Number of transfer hubs clustering wont be performed for
export const CANDIDATES_NO_CLUSTER_LIMIT = 10;

// Minimum score improvement a transfer hub needs to have to be used for car->transit trip in one specific case
export const TRANSFER_HUB_MIN_IMPROVEMENT = 10;

// Maximum attempts to query OTP with when a transit trip isnt found due to there not being an option in the generated search window
export const OTP_MAX_WINDOW_PAGING_ATTEMPTS = 10

// Factor for the number of clusters function
export const CLUSTER_NUMBER_FACTOR = 0.43;