/*
 * File: TransferHub.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom type containing information about a transfer hub form car->transit trip sections.
 */

export type TransferHub = {
    coords: { lat: number, lng: number },
    parkingCoords: { lat: number, lng: number },
    score: number,
    name: string,
};