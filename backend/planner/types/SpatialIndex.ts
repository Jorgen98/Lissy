/*
 * File: SpatialIndex.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type for the spatial index used for retreiving data about the rurality of a point in the map.
 */

export type SpatialIndex = {
    index: Map<string, { population: number, stops: Set<string> }>, // The actual index, implemented as a hash map, holds the population and set of stop ids in a spatial square cell  
    maxPopulation: number,  // Maximum population value in a cell in the index
    minPopulation: number,  // Minimum population value in a cell in the index
    maxStops: number,       // Maximum number of stops in a cell in the index
    minStops: number,       // Minimum number of stops in a cell in the index
}