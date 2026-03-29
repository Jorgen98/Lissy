/*
 * File: TripSortField.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Custom union type with names of fields the trip option array can get sort by.
 */

export type TripSortField = "default" | "duration" | "cost" | "numTransfers" | "startDatetime";