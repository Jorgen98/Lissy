/*
 * File: RouteWithShapes.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type given by the shapes module containing information about a route with defined shapes for its trips.
 */

export type RouteWithShapes = {
    route_short_name: string, 
    route_color: string, 
    trips: { 
        shape_id: number, 
        stops: string 
    }[]
};