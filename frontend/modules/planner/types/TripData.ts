import { TransportMode } from "./TransportMode"

// Custom type containing information about the trip in the trip form
export type TripData = {
    points: String[],                                       // Names of the points on the trip
    selectedModesGlobal: Record<TransportMode, Boolean>,    // Modes currently selected for trip planning (for all sections of the trip)
    sectionModes: Record<TransportMode, Boolean>[],         // Modes selected for planning between two adjecent points 
    returnTripActive: boolean,                              // Whether a return trip has been selected
}