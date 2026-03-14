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
        placeName?: string,
    }[],
    
    // Transport modes used for the trip and its sections
    modes: {
        global: Record<TransportMode, Boolean>,         // Modes currently selected for trip planning (for all sections of the trip)
        sections: Record<TransportMode, Boolean>[],     // Modes selected for planning between two adjecent points 
    }

    // Date and time information about the trip
    datetime: {
        tripDate: string,                               // Departure/arrival date of the trip as a string
        tripTime: string,                               // Departure/arrival time of the trip as a string
        datetimeOption: "departure" | "arrival"         // If the trip datetime represents departure or arrival time  
    }

    // Information about the return trip
    return: {
        active: boolean,                                // Whether the return trip option has been selected
        tripDate: string,                               // Departure/arrival date of the return trip as a string
        tripTime: string                                // Departure/arrival time of the return trip as a string
        datetimeOption: "departure" | "arrival"         // If the return trip datetime represents departure or arrival time  
    }
}