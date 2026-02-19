/*
 * File: gqlQueries.js
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * File with graphQL queries for OpenTripPlanner.
 */

// Get all stations from OTP, their coordinates and names
const allStationsQuery = `
    query StationsQuery {
        stations {
            lat
            lon
            name
        }
    }
`;

module.exports = { allStationsQuery };