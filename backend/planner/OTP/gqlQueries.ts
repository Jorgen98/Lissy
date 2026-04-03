/*
 * File: gqlQueries.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * File with graphQL queries for OpenTripPlanner.
 */

// Parametrized query for planning a trip between two points with OTP
export function getPlanConnectionQuery(datetimeOption: "arrival" | "departure"): string { 

    // For string interpolation in query, the given time could be the latest arrival time or earliest departure time
    const timeKey = datetimeOption === "arrival" ? "latestArrival" : "earliestDeparture";

    // Build and return parametrized query
    return `
        query PlanConnectionQuery(
            $pointALat: CoordinateValue!, 
            $pointALng: CoordinateValue!, 
            $pointBLat: CoordinateValue!, 
            $pointBLng: CoordinateValue!, 
            $datetime: OffsetDateTime!, 
            $directOnly: Boolean!, 
            $transitOnly: Boolean!,
            $directModes: [PlanDirectMode!],
            $transitModes: [PlanTransitModePreferenceInput!],
            $numOptions: Int!,
            $walkingSpeed: Speed!
            $afterCursor: String,
            $beforeCursor: String,
        ) {
            planConnection(
                origin: { 
                    location: { 
                        coordinate: { 
                            latitude: $pointALat, 
                            longitude: $pointALng 
                        } 
                    } 
                }
                destination: { 
                    location: { 
                        coordinate: { 
                            latitude: $pointBLat, 
                            longitude: $pointBLng 
                        } 
                    } 
                }
                dateTime: {
                    ${timeKey}: $datetime
                }
                modes: {
                    transitOnly: $transitOnly
                    directOnly: $directOnly
                    direct: $directModes
                    transit: {
                        transit: $transitModes
                    }
                }
                first: $numOptions
                preferences: {
                    street: {
                        walk: {
                            speed: $walkingSpeed
                        }
                    }
                }
                after: $afterCursor
                before: $beforeCursor
            ) {
                pageInfo {
                    hasNextPage
                    hasPreviousPage
                    endCursor
                    startCursor
                }
                edges {
                    node {
                        duration
                        start        
                        end
                        legs {
                            transitLeg
                            trip {
                                stops {
                                    zoneId
                                    name
                                }
                                gtfsId
                            }
                            distance
                            duration
                            from {
                                arrival {
                                    scheduledTime
                                }
                                departure {
                                    scheduledTime
                                }
                                stop {
                                    name
                                }
                            }
                            legGeometry {
                                length
                                points
                            }
                            mode
                            route {
                                color
                                shortName
                                textColor
                                gtfsId
                            }
                            to {
                                lat
                                lon
                                arrival {
                                    scheduledTime
                                }
                                departure {
                                    scheduledTime
                                }
                                stop {
                                    name
                                }
                            }
                        }
                    }
                }
                routingErrors {
                    description
                    code
                }
	        }
        }
    `;
}