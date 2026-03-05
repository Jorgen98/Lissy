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

// Width of square cell in the spatial index in meters
export const SPATIAL_INDEX_CELL_WIDTH = 3000;