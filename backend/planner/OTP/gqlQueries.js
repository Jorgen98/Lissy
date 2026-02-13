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