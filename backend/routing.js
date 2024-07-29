/*
 * Routing functions file
 */

const dbPostGIS = require('./db-postgis.js');

// Global configuration for every mode of transport
let configs = [
    // Rail
    {
        'maxWorstJumps': 50,
        'maxWorstJumpsWithTwoPoss': 70,
        'stopsFindRadius': 310,
        'subNetRadius': 100,
        'maxIterations': 50,
        'canReturn': true
    },
    // Road
    {
        'maxWorstJumps': 30,
        'maxWorstJumpsWithTwoPoss': 20,
        'stopsFindRadius': 120,
        'subNetRadius': 4,
        'maxIterations': 80,
        'canReturn': false
    },
    // Tram
    {
        'maxWorstJumps': 8,
        'maxWorstJumpsWithTwoPoss': 10,
        'stopsFindRadius': 200,
        'subNetRadius': 100,
        'maxIterations': 50,
        'canReturn': false
    }
]
let setUpConfig = undefined;
let transportMode = undefined;

// Main function
async function computeShape(trip) {
    transportMode = trip.transportMode;

    if (trip.transportMode === 'rail') {
        setUpConfig = configs[0];
    } else if (trip.transportMode === 'road') {
        setUpConfig = configs[1];
    } else {
        setUpConfig = configs[2];
    }

    // Get coords of stops belongs to potencial shape
    const stops = await dbPostGIS.getStopPositions(trip.stops);

    if (stops.length < 2) {
        return await saveNewShape(trip, [[]]);
    }

    // Find connection for every stop pair
    // The result will be array of arrays, array of points between stops
    let newShape = [];
    for (let idx = 0; idx < stops.length - 1; idx++) {
        let routingRes = await findConnection(stops[idx], stops[idx + 1]);

        if (routingRes.length < 2) {
            newShape.push([]);
        }
        newShape.push(routingRes);
    }

    // Save new shape
    return await saveNewShape(trip, newShape);
}

// Main routing function
// Tries to compute route from point to point, from stop to stop
async function findConnection(stopALatLng, stopBLatLng) {
    let possibilities = await findStopPosInNet(stopALatLng, 'start');
    if (possibilities.length < 1) {
        return [];
    }

    let subNet = await dbPostGIS.getSubNet(stopALatLng, stopBLatLng, transportMode, setUpConfig.subNetRadius);
    let endPositions = await findStopPosInNet(stopBLatLng, 'end');

    if (endPositions.length === 0) {
        return [];
    }

    let j = 0;
    while (j < possibilities.length) {
        if (subNet[possibilities[j].current] !== undefined) {
            possibilities[j].toEnd = countDistance(subNet[possibilities[j].current].pos, stopBLatLng.latLng);
            j++;
        } else {
            possibilities.splice(j, 1);
        }
    }

    let bestToEnd = Infinity;
    let itersNum = 0;
    let possNum = possibilities.length;
    let finishedPossNum = 0;
    let visitedHubs = {};
    let minLength = Infinity;

    while (itersNum < setUpConfig.maxIterations && finishedPossNum < possibilities.length) {
        itersNum++;
        bestToEnd = Infinity;
        finishedPossNum = 0;

        j = 0;
        let curIndx = 0;
        possibilities.sort((a, b) => b.finished - a.finished || a.toEnd - b.toEnd || a.length - b.length || a.score - b.score);
        if (possibilities.length > 4 && itersNum % 5 === 0 && itersNum > 0) {
            possibilities.splice(4);
        }

        j = 0;
        while (j < possibilities.length) {
            if (!possibilities[j].finished && possibilities[j].length < bestToEnd) {
                bestToEnd = possibilities[j].length;
                curIndx = j;
            } else if (possibilities[j].finished) {
                finishedPossNum++;
            }
            j++;
        }

        if (finishedPossNum > 1) {
            break;
        }

        let nextHubs = [];

        do {
            let lastPointCode = possibilities[curIndx].visited[possibilities[curIndx].visited.length - 1];

            if (subNet[possibilities[curIndx].current] === undefined || subNet[lastPointCode] === undefined) {
                nextHubs = [];
                break;
            }

            possibilities[curIndx].length += countDistance(subNet[possibilities[curIndx].current].pos, subNet[lastPointCode].pos);

            // Check if current position is finish
            for (let k = 0; k < endPositions.length; k++) {
                if (lastPointCode === endPositions[k].pointCodeA && possibilities[curIndx].current === endPositions[k].pointCodeB ||
                    lastPointCode === endPositions[k].pointCodeB && possibilities[curIndx].current === endPositions[k].pointCodeA ) {
                    possibilities[curIndx].finished = true;
                    possibilities[curIndx].score += JSON.parse(JSON.stringify(endPositions[k].score));
                    possibilities[curIndx].toEnd = 0;
                    finishedPossNum++;

                    if (minLength > possibilities[curIndx].length) {
                        minLength = possibilities[curIndx].length;
                    }
                    break;
                }
            }

            // If we find the finish, there is no need to continue in search
            if (possibilities[curIndx].finished) {
                break;
            }

            // Current hub actualization
            possibilities[curIndx].visited.push(possibilities[curIndx].current);
            // Find next hubs
            if (subNet[possibilities[curIndx].current] !== undefined) {
                nextHubs = JSON.parse(JSON.stringify(subNet[possibilities[curIndx].current].conns));
            } else {
                nextHubs = [];
            }

            // Remove reverse way possibilities
            if (nextHubs.indexOf(possibilities[curIndx].visited[possibilities[curIndx].visited.length - 2]) !== -1) {
                nextHubs.splice(nextHubs.indexOf(possibilities[curIndx].visited[possibilities[curIndx].visited.length - 2]), 1);
            }

            // Remove hubs, which are out of current map
            let k = 0;
            while (k < nextHubs.length) {
                if (subNet[nextHubs[k]] === undefined) {
                    nextHubs.splice(k, 1);
                } else {
                    let pointA = subNet[possibilities[curIndx].visited[possibilities[curIndx].visited.length - 2]].pos;
                    let pointB = subNet[possibilities[curIndx].current].pos;
                    let pointC = subNet[nextHubs[k]].pos;

                    if (getAngle(pointA, pointB, pointC) < 1) {
                        nextHubs.splice(k, 1);
                    } else {
                        k++;
                    }
                }
            }

            if (nextHubs.length === 1) {
                possibilities[curIndx].current = nextHubs[0];

                possibilities[curIndx].toEnd = countDistance(subNet[possibilities[curIndx].current].pos, stopBLatLng.latLng);
                if (possibilities[curIndx].lastToEnd < possibilities[curIndx].toEnd) {
                    possibilities[curIndx].numOfWorstJumps++;
                } else if (possibilities[curIndx].lastToEnd > possibilities[curIndx].toEnd) {
                    possibilities[curIndx].numOfWorstJumps--;
                }

                possibilities[curIndx].lastToEnd = JSON.parse(JSON.stringify(possibilities[curIndx].toEnd));
                if (possibilities[curIndx].numOfWorstJumps > setUpConfig.maxWorstJumps && possibilities.length > 2) {
                    nextHubs = [];
                } else if (possibilities[curIndx].numOfWorstJumps > setUpConfig.maxWorstJumpsWithTwoPoss) {
                    nextHubs = [];
                }
            }
        } while (nextHubs.length === 1 && !possibilities[curIndx].finished);

        // If we find the finish, there is no need to continue in search
        if (possibilities[curIndx].finished) {
            continue;
        }

        if (nextHubs.length === 0) {
            possibilities.splice(curIndx, 1);
            continue;
        }

        // Count new distance to finish
        possibilities[curIndx].toEnd = countDistance(subNet[possibilities[curIndx].current].pos, stopBLatLng.latLng);

        // If there is an possibility with better score, remove current possibility
        if (visitedHubs[possibilities[curIndx].current] !== undefined && visitedHubs[possibilities[curIndx].current] <= possibilities[curIndx].length) {
            possibilities.splice(curIndx, 1);
            continue;
        } else {
            visitedHubs[possibilities[curIndx].current] = possibilities[curIndx].length;
        }

        // Save new possibilities and distances to finish position
        for (let k = 1; k < nextHubs.length; k++) {
            possibilities.push(JSON.parse(JSON.stringify(possibilities[curIndx])));
            possibilities[possibilities.length - 1].length += countDistance(subNet[possibilities[curIndx].current].pos, subNet[nextHubs[k]].pos);
            possibilities[possibilities.length - 1].toEnd = countDistance(subNet[nextHubs[k]].pos, stopBLatLng.latLng);
            possibilities[possibilities.length - 1].current = nextHubs[k];
            possNum ++;
        }

        possibilities[curIndx].toEnd = countDistance(subNet[nextHubs[0]].pos, stopBLatLng.latLng);
        possibilities[curIndx].current = nextHubs[0];
    }

    for (let j = 0; j < possibilities.length; j++) {
        possibilities[j].visited.push(possibilities[j].current);
    }

    possibilities.sort((a, b) => b.finished - a.finished || a.score - b.score || a.length - b.length);

    if (possibilities[0] !== undefined && possibilities[0].finished) {
        let result = [];
        for (let visited of possibilities[0].visited) {
            if (subNet[visited] === undefined) {
                return [];
            }
            result.push(subNet[visited].pos);
        }
        return result;
    } else {
        return [];
    }
}

// Find stop nearest net hubs
async function findStopPosInNet(stopLatLng, stopOrderPosition) {
    let netPoints = await dbPostGIS.getPointsAroundStation(stopLatLng.geom, transportMode, setUpConfig.stopsFindRadius);
    if (netPoints.length < 1) {
        return [];
    }

    let pointsGid = {};
    let tmpPossibilities = {};
    for (const point of netPoints) {
        pointsGid[point.gid] = point;
        for (const conn of point.conns) {
            let key = point.gid + '_' + conn;
            if (stopOrderPosition === 'start') {
                tmpPossibilities[key] = {
                    'pointCodeA': point.gid,
                    'current': conn,
                    'score': 0,
                    'length': 0,
                    'toEnd': 0,
                    'finished': false,
                    'visited': [point.gid],
                    'lastToEnd': Infinity,
                    'numOfWorstJumps': 0
                };
            } else {
                tmpPossibilities[key] = {
                    'pointCodeA': point.gid,
                    'pointCodeB': conn,
                    'score': 0
                };
            }
        }
    }

    let resultPossibilities = [];

    for (const key in tmpPossibilities) {
        let pointA = pointsGid[tmpPossibilities[key].pointCodeA];
        let pointB = pointsGid[tmpPossibilities[key].current];

        if (stopOrderPosition === 'end') {
            pointB = pointsGid[tmpPossibilities[key].pointCodeB];
        }

        if (pointA === undefined || pointB === undefined) {
            continue;
        }

        tmpPossibilities[key].score = triangulation(pointA.latLng, pointB.latLng, stopLatLng.latLng);
        if (tmpPossibilities[key].score < Infinity) {
            if (stopOrderPosition === 'start') {
                delete tmpPossibilities[key].pointCodeA;
            }

            resultPossibilities.push(tmpPossibilities[key]);
        }
    }

    resultPossibilities.sort((a, b) => a.score - b.score);

    if (resultPossibilities.length < 1) {
        return [];
    } else if (resultPossibilities.length > 1) {
        if (resultPossibilities[0].score === resultPossibilities[1].score) {
            return [resultPossibilities[0], resultPossibilities[1]];
        } else {
            return [resultPossibilities[0]];
        }
    } else {
        return [resultPossibilities[0]];
    }
}

// Geometric support functions
function triangulation(edgeA, edgeB, point) {
    let angleCAB = getAngle(point, edgeA, edgeB);
    let angleCBA = getAngle(point, edgeB, edgeA);

    if (angleCAB > 1.63 || angleCBA > 1.63) {
        return Infinity;
    } else {
        return Math.min(Math.sin(angleCAB) * countDistance(point, edgeA), Math.sin(angleCBA) * countDistance(point, edgeB));
    }
}

// Two points distance calculation function
function countDistance(pointA, pointB) {
    // Length computation with Haversine formula
    const R = 6371e3;
    let lat_1_rad = pointA[0] * Math.PI / 180;
    let lat_2_rad = pointB[0] * Math.PI / 180;
    let delta_1 = (pointB[0] - pointA[0]) * Math.PI / 180;
    let delta_2 = (pointB[1] - pointA[1]) * Math.PI / 180;

    let a = Math.sin(delta_1 / 2) * Math.sin(delta_1 / 2) + Math.cos(lat_1_rad) * Math.cos(lat_2_rad) *
        Math.sin(delta_2 / 2) * Math.sin(delta_2 / 2);
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return(R * c);
}

// Get angle next to point y from two given lines defined by three points
function getAngle(x, y, z) {
    let x_y = Math.sqrt(Math.pow(y[0] - x[0], 2)+ Math.pow(y[1] - x[1], 2));
    let y_z = Math.sqrt(Math.pow(y[0] - z[0], 2)+ Math.pow(y[1] - z[1], 2));
    let x_z = Math.sqrt(Math.pow(z[0] - x[0], 2)+ Math.pow(z[1] - x[1], 2));

    return Math.acos((y_z * y_z + x_y * x_y - x_z * x_z) / (2 * y_z * x_y));
}

// Save new shape and actualize trips, which are going to use the new shape
async function saveNewShape(trip, newShape) {
    let newShapeId = await dbPostGIS.addShape(newShape);

    if (newShapeId === null) {
        return false;
    }

    return await dbPostGIS.updateTripsShapeId(trip.trip_ids, newShapeId);
}

module.exports = { computeShape };