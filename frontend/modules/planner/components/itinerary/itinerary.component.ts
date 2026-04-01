/*
 * File: itinerary.component.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Class for the itinerary component used in the planner module.
 */

import { HostListener, OnDestroy, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TripSectionLeg, TripOption } from '../../types/TripOption';
import { DatePipe } from '@angular/common';
import { DistancePipe } from '../../pipes/distance.pipe';
import { DurationPipe } from '../../pipes/duration.pipe';
import { AccordionModule } from 'primeng/accordion';
import { modeColors } from '../../utils/modeColors';
import { NgScrollbar, NgScrollbarModule } from 'ngx-scrollbar';
import { TripHeaderComponent } from '../trip-header/trip-header.component';
import { Subscription, Subject } from 'rxjs';
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { TripSortField } from '../../types/TripSortField';
import { 
    Component, 
    input, 
    output, 
    OnChanges, 
    SimpleChanges, 
    OnInit,
    Input
} from '@angular/core';

@Component({
    selector: 'itinerary',
    imports: [
        TranslatePipe, 
        DatePipe, 
        DistancePipe, 
        DurationPipe, 
        AccordionModule,
        NgScrollbarModule,
        TripHeaderComponent,
        SelectModule,
        FormsModule
    ],
    templateUrl: './itinerary.component.html',
    styleUrl: './itinerary.component.css',
})
export class ItineraryComponent implements OnChanges, OnInit, OnDestroy {

    constructor(
        public translate: TranslateService,
    ) { }

    // List of trip options, input from the root planner component
    public tripOptions = input<TripOption[] | null>(null);

    // Output emitting when the selected trip option has change, notifies the parent to redraw route
    public redrawTripOption = output<number>(); 

    // Output emitting when the selected trip option should be shown on the map, notifies the parent
    // Only used for mobile view
    public mobileShowTripOption = output<number>();

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
    @Input() public forceAction!: Subject<"open" | "close">;
    private forceActionSubscription!: Subscription;

    // Output emitting when the compact view is being exited by clicking on the one shown option (opens detail of that option)
    public forceDetail = output();

    // Output to notify the parent component to sort the trip options array by specified field
    public sortTripOptions = output<TripSortField>();

    // Output emitting to planner component that return trip render has been toggled
    // The parameter is type number if a return trip should be render from the trip options at the given index
    // If return trip is already drawn, null is emitted to clear it 
    public toggleReturnTrip = output<number | null>();

    // Whether a return trip is currently rendered
    public returnTripRendered = false;

    public isTouchDevice = input<boolean>(false);

    // List of field values and labels the trip options array can get sorted by
    // The label propery is translated in the HTML template of this component
    public sortSelectOptions: { value: TripSortField, label: string }[] = [
        { value: "startDatetime", label: "planner.itinerary.sortDeparture" },
        { value: "cost", label: "planner.itinerary.sortCost" },
        { value: "duration", label: "planner.itinerary.sortDuration" },
        { value: "numTransfers", label: "planner.itinerary.sortNumTransfers" },
    ];
    public selectedSortField: TripSortField = "startDatetime";

    // Store references to the scrollbar and to its child items for autoscrolling
    @ViewChild(NgScrollbar) scrollbox!: NgScrollbar;
    @ViewChildren('scrollbarPanel') scrollboxPanels!: QueryList<any>;

    // Variable holding the width of the window, updates on resize
    public windowWidth: number = window.innerWidth; 
    @HostListener('window:resize', ['$event'])
    onResize(event: any) {
        this.windowWidth = event.target.innerWidth;
    }

    // Called when the components directives or inputs change 
    ngOnChanges(changes: SimpleChanges): void {

        // If the tripOptions input changes, reset state of the selected option indicies
        if (changes["tripOptions"]) {
            this.accordionOptionValue = -1;
            this.selectedOptionIdx = 0;
            this.optionDetailActive = false;
        }
    }

    ngOnInit(): void {

        // Subscribe to changes from parent to collapse/uncollapse the form
        this.forceActionSubscription = this.forceAction.subscribe(action => {
            if (action === "open"){
                this.showCompactView = false;

                // If theres only one trip option available open the detail automatically
                if (this.tripOptions()?.length === 1) {
                    this.accordionOptionValue = 0;
                    this.selectedOptionIdx = 0;
                    this.optionDetailActive = true;
                }
            }
            else if (action === "close") {
                this.showCompactView = true;
                this.accordionOptionValue = -1;
                this.optionDetailActive = false;
            }
        });

        // Subscribe to language changes
        this.translate.onLangChange.subscribe(() => {

            // Check if some of the sections or legs have current location as the place name
            this.tripOptions()?.forEach(option => {
                option.sections.forEach(section => {
                    if (section.originName === "Moje poloha" || section.originName === "My location")
                        section.originName = this.translate.instant("planner.form.myLocation");

                    if (section.destinationName === "Moje poloha" || section.destinationName === "My location")
                        section.destinationName = this.translate.instant("planner.form.myLocation");

                    section.legs.forEach(leg => {
                        if (leg.from.placeName === "Moje poloha" || leg.from.placeName === "My location")
                            leg.from.placeName = this.translate.instant("planner.form.myLocation");

                        if (leg.to.placeName === "Moje poloha" || leg.to.placeName === "My location")
                            leg.to.placeName = this.translate.instant("planner.form.myLocation");
                    });
                });
            });

        });
    }

    ngOnDestroy(): void {
        this.forceActionSubscription.unsubscribe();
    }

    public returnTripToggled(idx: number | null): void {
        this.toggleReturnTrip.emit(idx);
        this.returnTripRendered = idx !== null;
    }

    // Function setting necessary variables to default values when the itinerary is cleared
    public clearItineraryState(): void {
        this.selectedSortField = "startDatetime";
        this.returnTripRendered = false;
        this.clearItinerary.emit();
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

            // Autoscroll to currently selected option after the list of options is rerendered
            setTimeout(() => {
                this.scrollToSelected();
            });
        }

        // If the clicked trip option is different then the previous, emit to parent to redraw route
        if (this.selectedOptionIdx !== index) {
            this.redrawTripOption.emit(index);
            this.returnTripRendered = false;
            this.toggleReturnTrip.emit(null);
        }

        this.selectedOptionIdx = index;
    }

    // Function called when the go back button is clicked in the itinerary, closes detail of option
    public backButtonClicked() {
        this.accordionOptionValue = -1;
        this.optionDetailActive = false;

        // Autoscroll to currently selected option after the list of options is rerendered
        setTimeout(() => {
            this.scrollToSelected();
        });
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

    // Function called when the export button is clicked, exports the given trip option
    public exportTrip(trip: TripOption): void {
        // https://www.30secondsofcode.org/js/s/json-to-file/

        // Serialize TS object into a string
        const serialized = JSON.stringify(trip);

        // Create blob object and URL for it
        const blob = new Blob([serialized], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // Create anchor element, change attributes to the created URL and set filename and click it, invoking the download
        const a = document.createElement('a');
        a.href = url;
        a.download = `trip_${Date.now()}.json`;
        a.click();

        // Release the created URL
        URL.revokeObjectURL(url);
    }

    // Function that autoscrolls to selected item after itinerary detail is closed
    private scrollToSelected(): void {
        const selectedOptionElement = this.scrollboxPanels.get(this.selectedOptionIdx)?.el?.nativeElement;
        if (selectedOptionElement)
            this.scrollbox.scrollTo({ top: selectedOptionElement.offsetTop, duration: 300 });
    }
}
