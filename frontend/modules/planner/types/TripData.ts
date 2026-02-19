/*
 * File: TripData.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about the trip in the trip form.
 */
import { TransportMode } from "./TransportMode"

export type TripData = {
    // Coordinates of the points on the trip
    points: { 
        lat?: number, 
        lng?: number,
    }[],                                
    selectedModesGlobal: Record<TransportMode, Boolean>,    // Modes currently selected for trip planning (for all sections of the trip)
    sectionModes: Record<TransportMode, Boolean>[],         // Modes selected for planning between two adjecent points 
    returnTripActive: boolean,                              // Whether a return trip has been selected
}