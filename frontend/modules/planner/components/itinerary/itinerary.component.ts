/*
 * File: itinerary.component.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Class for the itinerary component used in the planner module.
 */

import { Component, input, output, OnChanges, SimpleChanges } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TripSectionLeg, TripOption } from '../../types/TripOption';
import { DatePipe } from '@angular/common';
import { DistancePipe } from '../../pipes/distance.pipe';
import { DurationPipe } from '../../pipes/duration.pipe';
import { AccordionModule } from 'primeng/accordion';
import { modeColors } from '../../utils/modeColors';

@Component({
    selector: 'itinerary',
    imports: [
        TranslatePipe, 
        DatePipe, 
        DistancePipe, 
        DurationPipe, 
        AccordionModule
    ],
    templateUrl: './itinerary.component.html',
    styleUrl: './itinerary.component.css',
})
export class ItineraryComponent implements OnChanges {

    constructor(
        public translate: TranslateService,
    ) { }

    // List of trip options, input from the root planner component
    public tripOptions = input<TripOption[] | null>(null);

    // Output emitting when the selected trip option has change, notifies the parent to redraw route
    public redrawTripOption = output<number>(); 

    // Output emitting when the itinerary clear button is clicked
    public clearItinerary = output();

    // Index of the currently selected trip option
    public selectedOptionIdx: number = 0;

    // Value of the currently selected (expanded) panel in the accordion (-1 if none are expanded)
    public accordionOptionValue = -1;

    // Whether a detail view of a trip option is currently visible
    public optionDetailActive = false;

    // Whether the itinerary is currently in compact view, only showing the header of the selected option
    public showCompactView: boolean = false;

    // Input from the parent telling to itinerary to close itself (compact mode) or open (all options shown)
    public forceAction = input<"close" | "open" | null>(null);

    // Output emitting when the compact view is being exited by clicking on the one shown option (opens detail of that option)
    public forceDetail = output();

    // Called when the components directives or inputs change 
    ngOnChanges(changes: SimpleChanges): void {

        // If the tripOptions input changes, reset state of the selected option indicies
        if (changes["tripOptions"]) {
            this.accordionOptionValue = -1;
            this.selectedOptionIdx = 0;
            this.optionDetailActive = false;
        }

        // React to a force close or force open from the parent component 
        if (changes["forceAction"]) {
            if (this.forceAction() === "open"){
                this.showCompactView = false;

                // If theres only one trip option available open the detail automatically
                if (this.tripOptions()?.length === 1) {
                    this.accordionOptionValue = 0;
                    this.selectedOptionIdx = 0;
                    this.optionDetailActive = true;
                }
            }
            else if (this.forceAction() === "close") {
                this.showCompactView = true;
                this.accordionOptionValue = -1;
                this.optionDetailActive = false;
            }
        }
    }

    // Function called when the user clicks on a trip option
    public changeTripOption(index: number): void {

        // If the itinerary is currently in compact view, emit to parent that the detail will be opened
        if (this.showCompactView) {
            this.forceDetail.emit();
            this.optionDetailActive = true;
            this.accordionOptionValue = this.selectedOptionIdx;
            this.showCompactView = false;
            return;
        }

        // Change the selected accordion option accordingly
        if (!this.optionDetailActive) {
            this.optionDetailActive = true;
            this.accordionOptionValue = index;
        }
        else if (this.optionDetailActive) {
            this.optionDetailActive = false;
            this.accordionOptionValue = -1;
        }

        // If the clicked trip option is different then the previous, emit to parent to redraw route
        if (this.selectedOptionIdx !== index)
            this.redrawTripOption.emit(index);

        this.selectedOptionIdx = index;
    }

    // Function called when the go back button is clicked in the itinerary, closes detail of option
    public backButtonClicked() {
        this.accordionOptionValue = -1;
        this.optionDetailActive = false;
    }

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
