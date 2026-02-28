/*
 * File: itinerary.component.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Class for the itinerary component used in the planner module.
 */

import { Component, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TripSectionOption } from '../../types/TripSectionOption';
import { DatePipe } from '@angular/common';
import { DistancePipe } from '../../pipes/distance.pipe';
import { DurationPipe } from '../../pipes/duration.pipe';

@Component({
    selector: 'itinerary',
    imports: [TranslatePipe, DatePipe, DistancePipe, DurationPipe],
    templateUrl: './itinerary.component.html',
    styleUrl: './itinerary.component.css',
})
export class ItineraryComponent {

    constructor(
        public translate: TranslateService,
    ) { }

    // List of trip options, input from the root planner component
    public tripOptions = input<TripSectionOption[] | null>(null);

    // Output emitting when the selected trip option has change, notifies the parent to redraw route
    public redrawTripOption = output<number>(); 

    // Output emitting when the itinerary clear button is clicked
    public clearItinerary = output();

    // Index of the currently selected trip option
    public selectedOptionIdx: number = 0;

    // Function called when the user clicks on a trip option
    public changeTripOption(index: number): void {

        // If the clicked trip option is different then the previous, emit to parent to redraw route
        if (this.selectedOptionIdx !== index)
            this.redrawTripOption.emit(index);

        this.selectedOptionIdx = index;
    }
}
