/*
 * File: gqlQueries.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * File with graphQL queries for OpenTripPlanner.
 */

// Get all stations from OTP, their coordinates and names
export const allStationsQuery = `
    query StationsQuery {
        stations {
            lat
            lon
            name
        }
    }
`;