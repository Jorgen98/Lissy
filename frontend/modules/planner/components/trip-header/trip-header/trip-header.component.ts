/*
 * File: trip-header.component.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Class for the header component describing a single trip option.
 */

import { Component, input } from '@angular/core';
import { TripOption, TripSectionLeg } from '../../../types/TripOption';
import { modeColors } from '../../../utils/modeColors';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DurationPipe } from '../../../pipes/duration.pipe';
import { DecimalPipe } from '@angular/common';
import { DistancePipe } from '../../../pipes/distance.pipe';

@Component({
    selector: 'trip-header',
    imports: [DatePipe, TranslatePipe, DurationPipe, DistancePipe, DecimalPipe],
    templateUrl: './trip-header.component.html',
    styleUrl: './trip-header.component.css',
})
export class TripHeaderComponent {

    // The trip option to render, input from parent
    public option = input<TripOption | null>(null);

    // Function retrieving the color of the leg based on the mode and availability from GTFS
    public getLegColor(leg: TripSectionLeg): string {

        // If the leg doesnt have a transport system route defined, or the color is not provided, get hardcoded value
        if (leg.route === null || leg.route.color === null)
            return modeColors[leg.mode];

        // Otherwise return formatted hex color
        return `#${leg.route.color}`;
    }

    // Function retrieving the text color of the leg based on the mode and availability from GTFS
    public getLegTextColor(leg: TripSectionLeg): string {

        // If the leg doesnt have a transport system route defined, or the text color is not provided, use black text
        if (leg.route === null || leg.route.textColor === null)
            return "#000000";

        // Otherwise return formatted hex text color
        return `#${leg.route.textColor}`;
    }
}
