/*
 * File: duration.pipe.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 * 
 * Angular pipe for converting duration in seconds to formatted string.
 */

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'duration',
})
export class DurationPipe implements PipeTransform {
    transform(seconds: number): string {

        // Format to seconds if the duration is less than a minute
        if (seconds < 60)
            return `${seconds} s`;

        // Format to minutes if the duration is less than an hour
        // Also add seconds if its less than three minutes
        const minutes = Math.floor(seconds / 60);
        if (minutes < 3)
            return `${minutes} min ${seconds % 60} s`;
        else if (minutes < 60)
            return `${minutes} min`;

        // Otherwise format to hh:mm
        const hours = Math.floor(minutes / 60);
        const modMins = Math.floor((seconds % 3600) / 60);
        return `${hours} h ${modMins} min`;
    }
}
