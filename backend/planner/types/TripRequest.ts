/*
 * File: TripRequest.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about the trip request coming from the client.
 * Similar to the imported TripDataExtended data type from the frontend, but without possibly undefined fields.
 */

import { TripDataExtended } from "../../../frontend/modules/planner/types/TripDataExtended";

// The points field in TripData has possibly undefined values, that wont be the case in the backend
export type TripRequest = Omit<TripDataExtended, 'points'> & {
    points: Required<{ lat: number, lng: number, placeName?: string }>[];
};