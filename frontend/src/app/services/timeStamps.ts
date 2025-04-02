/*
 * UTC time stamp handle functions
 *
 * Custom time stamp format is YYYY-MM-DD
 */

// Convert JS Date to time
export function getDate(timeStamp: string) {
    return new Date(`${parseInt(timeStamp.split('-')[0])}-${parseInt(timeStamp.split('-')[1]) + 1}-${parseInt(timeStamp.split('-')[2])}`);
}

// Convert JS Date to time
export function getTimeStamp(date: number) {
    let newDate = new Date(date);
    return `${newDate.getUTCFullYear()}-${newDate.getUTCMonth()}-${newDate.getUTCDate()}`;
}

// Compare to time stamps
export function compareTimeStamps(timeStampA: string, timeStampB: string) {
    let valueA = timeStampA.split('-');
    let valueB = timeStampB.split('-');
    if (valueA[0] !== valueB[0]) {
        return parseInt(valueA[0]) < parseInt(valueB[0]) ? -1 : 1;
    } else if (valueA[1] !== valueB[1]) {
        return parseInt(valueA[1]) < parseInt(valueB[1]) ? -1 : 1;
    } else {
        return parseInt(valueA[2]) < parseInt(valueB[2]) ? -1 : 1;
    }
}

// Move time stamp to future
export function addOneDayToTimeStamp(timeStamp: string) {
    let date = new Date(Date.UTC(parseInt(timeStamp.split('-')[0]), parseInt(timeStamp.split('-')[1]), parseInt(timeStamp.split('-')[2])));
    let dateValue = date.setUTCDate(date.getUTCDate() + 1);
    return getTimeStamp(dateValue);
}

// Move time stamp to past
export function removeOneDayFromTimeStamp(timeStamp: string) {
    let date = new Date(Date.UTC(parseInt(timeStamp.split('-')[0]), parseInt(timeStamp.split('-')[1]), parseInt(timeStamp.split('-')[2])));
    let dateValue = date.setUTCDate(date.getUTCDate() - 1);
    return getTimeStamp(dateValue);
}

// Convert time stamp to transport format
