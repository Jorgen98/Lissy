/*
 * File: TripData.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about the trip in the trip form.
 * Extension from the TripData type with set user preferences
 */

import { TripData } from "./TripData";

export type TripDataExtended = TripData & {

    // Append information about user preferences to TripData type
    preferences: {
        walk: {
            maxDistance: number | null, // Maximum allowed walking distance
            avgSpeed: number            // Average walking speed
        },
        publicTransport: {

            // Modes allowed for planning transit legs
            allowedModes: {
                bus: boolean,
                trolleybus: boolean,
                tram: boolean,
                train: boolean,
                ferry: boolean,
            }
        }
    }
};