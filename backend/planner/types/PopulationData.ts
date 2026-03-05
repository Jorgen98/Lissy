/*
 * File: PopulationData.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type describing the structure of the population_data geojson file for easier handling of it in TypeScript.
 */

export type PopulationData = {
    type: string,
    name: string,
    crs: { type: string, properties: { name: string } },
    features: {
        properties: { 
            subcell_center: string, 
            population: number, 
            nearby_stops: string | any[]
        }
    }[],
    geometry: {
        type: string,
        coordinates: [number, number][][],
    }
};