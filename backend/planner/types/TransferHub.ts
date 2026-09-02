/*
 * File: TransferHub.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about a transfer hub form car->transit trip sections.
 */

import { LatLng } from "./LatLng";

export type TransferHub = {
    coords: LatLng,
    parkingCoords: LatLng,
    score: number,
    name: string,
};