/*
 * File: TripData.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about the trip in the trip form.
 * Extension from the TripData type with set user preferences
 */

import { TripData } from "./TripData";

export type TripDataExtended = TripData & {
    preferences: {
        walk: {
            maxDistance: number | null,
            avgSpeed: number
        },
        publicTransport: {
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