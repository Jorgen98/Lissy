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
export const MIN_DRIVE_DISTANCE = 1000;

// Radius to look for nearby stops in for scoring of an arbitrary point
export const SCORE_STOP_RADIUS = 1000;

// The fraction used in getTransferHubs function which shifts the center of the radius along a line between two points 
export const TRANSFER_HUB_RADIUS_SHIFT = 0.4;

// Number of transfer hubs clustering wont be performed for
export const CANDIDATES_NO_CLUSTER_LIMIT = 10;

// Maximum attempts to query OTP with when a transit trip isnt found due to there not being an option in the generated search window
export const OTP_MAX_WINDOW_PAGING_ATTEMPTS = 10