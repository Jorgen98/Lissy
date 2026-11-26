/*
 * Time stamp help functions
 *
 * Author: Juraj Lazur (ilazur@fit.vut.cz)
 * Contributors: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
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
function getDateFromISOTimeStamp(timeStamp) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(timeStamp)) {
        const [y, m, d] = timeStamp.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    }

    if (/^\d{8}$/.test(timeStamp)) {
        const y = Number(timeStamp.slice(0, 4));
        const m = Number(timeStamp.slice(4, 6));
        const d = Number(timeStamp.slice(6, 8));
        return new Date(Date.UTC(y, m - 1, d));
    }
console.log(timeStamp)
    return false;
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
function addDayToTimeStamp(timeStamp, days = 1) {
    let date = new Date(Date.UTC(timeStamp.split('-')[0], timeStamp.split('-')[1], timeStamp.split('-')[2]));
    date = date.setUTCDate(date.getUTCDate() + days);
    return getTimeStamp(date);
}

// Move time stamp to past
function removeDayFromTimeStamp(timeStamp, days = 1) {
    let date = new Date(Date.UTC(timeStamp.split('-')[0], timeStamp.split('-')[1], timeStamp.split('-')[2]));
    date = date.setUTCDate(date.getUTCDate() - days);
    return getTimeStamp(date);
}

// Get timezone of device
function getLocalTimezone() {
    const UTCoffset = -new Date().getTimezoneOffset();
    const hours = Math.floor(Math.abs(UTCoffset) / 60);
    const minutes = Math.abs(UTCoffset) % 60;
    const sign = UTCoffset >= 0 ? '+' : '-';

    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

module.exports = { getTimeStamp, getDateFromTimeStamp, compareTimeStamps, addDayToTimeStamp, removeDayFromTimeStamp, getTodayUTC, getDateFromISOTimeStamp, getLocalTimezone }
