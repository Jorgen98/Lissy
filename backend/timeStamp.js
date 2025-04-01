/*
 * Time stamp help functions
 */

// Convert JS date intro time stamp
function getTimeStamp(date) {
    date = new Date(date);
    return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

// Convert time stamp into JS UTC date
function getDateFromTimeStamp(timeStamp) {
    return new Date(Date.UTC(parseInt(timeStamp.split('-')[0]), parseInt(timeStamp.split('-')[1]), parseInt(timeStamp.split('-')[2])));
}

// Convert time stamp into JS UTC date
function getTodayUTC() {
    let now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
}

// Compare two timestamps
function compareTimeStamps(timeStampA, timeStampB) {
    let valueA = timeStampA.split('-');
    let valueB = timeStampB.split('-');
    if (valueA[0] !== valueB[0]) {
        return parseInt(valueA[0]) <= parseInt(valueB[0]) ? -1 : 1;
    } else if (valueA[1] !== valueB[1]) {
        return parseInt(valueA[1]) <= parseInt(valueB[1]) ? -1 : 1;
    } else {
        return parseInt(valueA[2]) <= parseInt(valueB[2]) ? -1 : 1;
    }
}

// Move time stamp to future
function addOneDayToTimeStamp(timeStamp) {
    let date = new Date(Date.UTC(timeStamp.split('-')[0], timeStamp.split('-')[1], timeStamp.split('-')[2]));
    date = date.setUTCDate(date.getUTCDate() + 1);
    return getTimeStamp(date);
}

// Move time stamp to past
function removeOneDayToTimeStamp(timeStamp) {
    let date = new Date(Date.UTC(timeStamp.split('-')[0], timeStamp.split('-')[1], timeStamp.split('-')[2]));
    date = date.setUTCDate(date.getUTCDate() - 1);
    return getTimeStamp(date);
}

module.exports = { getTimeStamp, getDateFromTimeStamp, compareTimeStamps, addOneDayToTimeStamp, removeOneDayToTimeStamp, getTodayUTC }