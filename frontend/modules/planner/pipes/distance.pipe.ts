/*
 * File: distance.pipe.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 * 
 * Angular pipe for converting distance in meters to formatted string.
 */

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'distance',
})
export class DistancePipe implements PipeTransform {

    transform(meters: number): string {

        // Format string with meters if the distance is less than a kilometer
        if (meters < 1000)
            return `${meters.toFixed(0)} m`;

        // Otherwise show kilometers, with one decimal space if the number of kms is one digit
        return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
    }

}
