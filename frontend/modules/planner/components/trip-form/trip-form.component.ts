/*
 * File: trip-form.component.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Class for the trip form component used in the planner module.
 */

import { TransportMode } from '../../types/TransportMode';
import { TranslateService } from '@ngx-translate/core';
import { ImportsModule } from '../../../../src/app/imports';
import { LocationStatus } from '../../types/LocationStatus';
import { UIMessagesService } from '../../../../src/app/services/messages';
import { MapService } from '../../../../src/app/map/map.service';
import { TripData } from '../../types/TripData';
import { MarkerType } from '../../types/MarkerType';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { FormControl, FormsModule, ReactiveFormsModule, FormArray } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { Stop } from '../../types/Stop';
import { debounceTime, map, startWith, Observable, Subject, Subscription } from 'rxjs';
import { NgScrollbarModule } from 'ngx-scrollbar';
import { 
    CdkDrag, 
    CdkDropList, 
    CdkDragDrop, 
    moveItemInArray, 
    CdkDragHandle, 
} from '@angular/cdk/drag-drop';
import { 
    Component, 
    AfterViewInit, 
    OnDestroy, 
    output, 
    input, 
    OnInit, 
    OnChanges, 
    SimpleChanges, 
    Input,
    ViewChildren,
    QueryList,
    ElementRef
} from '@angular/core';

@Component({
    selector: 'trip-form',
    imports: [
        ImportsModule, 
        CdkDrag, 
        CdkDropList, 
        CdkDragHandle, 
        FormsModule, 
        MatAutocompleteModule, 
        ReactiveFormsModule, 
        AsyncPipe,
        NgScrollbarModule
    ],
    templateUrl: './trip-form.component.html',
    styleUrl: './trip-form.component.css',
})
export class TripFormComponent implements AfterViewInit, OnDestroy, OnInit, OnChanges {
    
    // Whether the main trip input for is currently collapsed
    public formCollapsed: Boolean = false;

    // Object containing information about the trip currently in the form, initialized to default state
    public tripData: TripData = {
        points: [{}, {}],   // Coordinates of points on the trip, start off empty/undefined

        // Transport modes used for the trip and its sections
        modes: {
            global: {       // Modes globally selected for planning
                publicTransport: true,
                car: false, 
                walk: false,
            },
            sections: [],   // Modes selected between adjacent midpoints
        },

        // Date and time information about the trip
        datetime: {
            tripDate: "",               // Departure/arrival date of the trip as a string
            tripTime: "",               // Departure/arrival time of the trip as a string
            datetimeOption: "departure" // If the trip datetime represents departure or arrival time  
        },

        return: {
            active: false,              // Whether the return trip is active
            tripDate: "",               // Departure/arrival time of the return trip as a string
            tripTime: "",               // Departure/arrival time of the return trip as a string
            datetimeOption: "departure" // If the return trip datetime represents departure or arrival time 
        }
    }

    // List of element references to the point <input> elements
    @ViewChildren('pointInput') inputs!: QueryList<ElementRef<HTMLInputElement>>;

    // Status of current location availability
    public locationStatus: LocationStatus = "default";

    // Current location coordinates
    private currentLocation: { lat?: number, lng?: number } = {};

    // Output for notifying the parent planner component that a marker has been clicked in the form to select point in the map
    public markerClick = output<{ type: MarkerType, position: number }>();

    // Input from the parent component notifying the child to add coordinates of the map click as a trip point at the given position
    public mapClickWithMarkerCursor = input<{ coords: L.LatLng, position: number} | null>(null);

    // Output for notifying the parent planner component that a trip request has been submitted by the user
    public tripSubmit = output<TripData>();

    // Id for current location watch
    private locationWatchId: number = -1; 

    // Array of transport system stops received from the backend, input from the parent component
    public stops = input<Stop[]>([]);

    // Each form input has its own list of stops that match the substring entered into the input element for autocomplete
    // Observable so the autocomplete can be updated while typing
    public filteredStopsArray: Observable<Stop[]>[] = []

    // Output for notifying the parent planner component to reverse geocode the coordinates
    public reverseGeocode = output<{ lat: number, lng: number, position: number }>();

    // Input which receives the reverse geocoded place name and which position in the form it should be written to
    public geocodedPlaceName = input<{ name: string, position: number } | null>();

    // Dynamic array of controls for individual trip point inputs
    public pointControls = new FormArray<FormControl<string>>([
        new FormControl('', { nonNullable: true }),
        new FormControl('', { nonNullable: true })
    ]);

    // Set of trip point indicies for point which are currently tracking the live location
    private tripPointsWithLocationTracking = new Set<number>();

    // Input from the parent telling the form to collapse itself or uncollapse (Input directive instead of input<> for rxjs Subject)
    @Input() public forceAction!: Subject<"open" | "close">;
    private forceActionSubscription!: Subscription;

    // Output emitting when the form is collapsed or uncollapsed
    public collapseAction = output<"collapse" | "uncollapse">();

    // Index of modes between trip points where there are invalid modes selected
    public invalidModesIdx: number | null = null;

    public isTouchDevice = input<boolean>(false);

    // Getter for number of globally selected transport modes
    get selectedModesCount(): number {
        const global = this.tripData.modes.global;
        return Number(global.publicTransport) 
            + Number(global.car)
            + Number(global.walk);
    }

    constructor(
        public translate: TranslateService,
        private msgService: UIMessagesService,
        private mapService: MapService,
    ) { }

    ngOnInit(): void {

        // Create and initialize arrays with filtered stops for origin and destination points
        this.filteredStopsArray = [
            this.createFilteredStops(0),
            this.createFilteredStops(1)
        ];

        // Subscribe to changes from parent to collapse/uncollapse the form
        this.forceActionSubscription = this.forceAction.subscribe(action => {
            if (action === "close")
                this.formCollapsed = true;
            else
                this.formCollapsed = false;
        });

        // Subscribe to language changes
        this.translate.onLangChange.subscribe(() => {

            // Check if some of the controls have hardcoded my location or point from map values
            this.pointControls.controls.forEach(control => {
                if (control.value === "Point from map" || control.value === "Bod z mapy")
                    control.setValue(this.translate.instant("planner.form.pointFromMap"));
                else if (control.value === "Moje poloha" || control.value === "My location")
                    control.setValue(this.translate.instant("planner.form.myLocation"));
            });

            // Check if some of the trip points have my location
            this.tripData.points.forEach(point => {
                if (point.placeName === "Moje poloha" || point.placeName === "My location")
                    point.placeName = this.translate.instant("planner.form.myLocation");
            });
        });
    }

    ngAfterViewInit(): void {

        // Get current date and time and get individual elements
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        // Register callback to store the current trip date and time in the form
        // The assignment of datetime needs to happen only after the first Angular change detection cycle is done to avoid errors in this.isFormValid()
        setTimeout(() => {
            this.tripData.datetime.tripDate = `${year}-${month}-${day}`;
            this.tripData.datetime.tripTime = `${hours}:${minutes}`;
        });
    }

    ngOnDestroy(): void {

        this.forceActionSubscription.unsubscribe();

        // Clear watching for current location and remove existing layers
        navigator.geolocation.clearWatch(this.locationWatchId);
        this.mapService.removeLayer("currentLocation");
        this.mapService.removeLayer("tripPoints");
    }

    // Called when the components directives or inputs change 
    ngOnChanges(changes: SimpleChanges): void {

        // Check if the parent component emitted map coordinates of a click with a trip point position
        if (changes["mapClickWithMarkerCursor"] && this.mapClickWithMarkerCursor()) {
            const position = this.mapClickWithMarkerCursor()!.position;

            // Store the received coordinates into trip data and set value of the form control
            this.tripData.points[position] = this.mapClickWithMarkerCursor()!.coords; 
            this.pointControls.controls.at(position)?.setValue(this.translate.instant("planner.form.pointFromMap"));
            this.tripPointsWithLocationTracking.delete(position);

            // Request reverse geocoding of coordinates
            const lat = this.mapClickWithMarkerCursor()!.coords.lat;
            const lng = this.mapClickWithMarkerCursor()!.coords.lng;
            this.reverseGeocode.emit({ lat, lng, position });

            // Redraw markers with new trip point
            this.redrawTripMarkers();
        }

        // Geocoded place name was received in the parent planner
        if (changes["geocodedPlaceName"] && this.geocodedPlaceName() !== null) {
            const position = this.geocodedPlaceName()?.position;
            const name = this.geocodedPlaceName()?.name;

            // If both the values are valid, set value of the corresponding input in the form and name of trip point
            if (position !== undefined && name !== undefined) {
                this.pointControls.controls.at(position)!.setValue(name);
                this.tripData.points[position].placeName = name;
            }
        }
    }

    // Function called when a transport mode is toggled as on/off
    // If index is set, the transport mode was set/unset between adjacent points in a trip section, otherwise globally
    public modeToggled(mode: TransportMode, index?: number): void {
        if (index !== undefined)
            this.tripData.modes.sections[index][mode] = !this.tripData.modes.sections[index][mode];
        else {
            this.tripData.modes.global[mode] = !this.tripData.modes.global[mode];

            // Adjust section modes if the global modes were edited
            this.updateSectionModes(mode);
        }

        // Check valid modes across sections
        this.checkSeperatedCarSections();
    }

    // Function called when the collapse button in the header is clicked
    public collapseBtnClicked() {
        this.formCollapsed = !this.formCollapsed;

        // Notify parent with space requirement or surplus
        this.collapseAction.emit(this.formCollapsed ? "collapse" : "uncollapse");
    }

    // Function called when a point is dropped after dragged
    public pointDropped(event: CdkDragDrop<string[]>): void {

        // Reorder the necessary arrays after drag and drop movement is finished
        moveItemInArray(this.tripData.points, event.previousIndex, event.currentIndex);
        moveItemInArray(this.filteredStopsArray, event.previousIndex, event.currentIndex);
        moveItemInArray(this.pointControls.controls, event.previousIndex, event.currentIndex);

        // Redraw the trip point markers after change in points array
        this.redrawTripMarkers();
    }

    // Function called when the button to reverse the trip points is clicked
    public reverseTripPoints(): void {

        // Reverse content of all necessary arrays
        this.tripData.points.reverse();
        this.filteredStopsArray.reverse();
        this.pointControls.controls.reverse();

        // Redraw the trip point markers after change in points array
        this.redrawTripMarkers();
    }

    // Function for fetching the current location on user request
    public locationClicked(tripPointPosition?: number): void {

        // Blur the filled input
        if (tripPointPosition !== undefined) {
            setTimeout(() => {
                this.inputs.get(tripPointPosition)?.nativeElement.blur();
            }, 0);
        }

        // If the location hasnt been fetched before, add a new layer on the map and fetch
        if (this.locationStatus === "default") {
            this.mapService.addNewLayer({
                name: "currentLocation",
                layer: undefined,
                palette: {},
                paletteItemName: "",
            });
            this.fetchCurrentLocation(tripPointPosition);
        }

        // If the location is currently shown and the current location was chosen as a trip point, store it in trip data
        else if (this.locationStatus === "enabled" && tripPointPosition !== undefined) {
            this.tripData.points[tripPointPosition] = this.currentLocation;
            this.tripData.points[tripPointPosition].placeName = this.translate.instant("planner.form.myLocation");

            // This trip point is currently tracking the location
            this.tripPointsWithLocationTracking.add(tripPointPosition);

            // Redraw the trip point markers with new marker on current location
            this.redrawTripMarkers();
        }

        // If the location is currently shown, disable it, clear watch and layer, clear current location
        else if (this.locationStatus === "enabled") {
            this.locationStatus = "disabled";
            navigator.geolocation.clearWatch(this.locationWatchId);
            this.mapService.clearLayer("currentLocation");
            this.currentLocation = {};

            // Clear trip points which have current location selected
            this.pointControls.controls.forEach((control, index) => {
                if (control.value === "Moje poloha" || control.value === "My location") {
                    control.setValue("");
                    this.tripData.points[index] = {};

                    // Remove points from location tracking
                    this.tripPointsWithLocationTracking.delete(index);
                }
            });

            // Some trip points might have been cleared, redraw markers
            this.redrawTripMarkers();
        }

        // Refetch in case of previous user disable or error
        else if (this.locationStatus === "disabled")
            this.fetchCurrentLocation(tripPointPosition);
    }

    // Function adding a new trip midpoint to the form
    public addMidpoint(position: number): void {

        // Add new point with empty coordinates at given position, a new empty input control and array with filtered stops
        this.tripData.points.splice(position, 0, {});
        this.pointControls.insert(position, new FormControl('', { nonNullable: true }));
        this.filteredStopsArray.splice(position, 0, this.createFilteredStops(position));

        // If the number of points reaches 3, create two copies of the global selected modes and add that as modes in the two sections
        if (this.tripData.points.length === 3) {
            this.tripData.modes.sections[0] = { ...this.tripData.modes.global };
            this.tripData.modes.sections[1] = { ...this.tripData.modes.global };
        }

        // Copy global selected modes to the new created section
        else
            this.tripData.modes.sections.splice(position - 1, 0, { ...this.tripData.modes.global });

        // Check valid modes across sections
        this.checkSeperatedCarSections();
    }

    // Function deleting trip midpoint from the form
    public removeMidpoint(position: number): void {

        // Remove point from the trip data, its form input control and the array of filtered stops
        this.tripData.points.splice(position, 1);
        this.pointControls.removeAt(position);
        this.filteredStopsArray.splice(position, 1);

        // If the number of points reaches 2, clear the section modes
        if (this.tripData.points.length == 2)
            this.tripData.modes.sections = [];

        // Otherwise remove the section modes between deleted point and the point below it
        else
            this.tripData.modes.sections.splice(position, 1);

        // Redraw markers after midpoint has been removed
        this.redrawTripMarkers();

        this.checkSeperatedCarSections();
    }

    // Function called when a stop has been selected from autocomplete
    // 'stop' is the selected stop and 'position' holds which trip point the stop was selected for
    public stopSelected(stop: Stop, position: number): void {

        // Blur the filled input
        setTimeout(() => {
            this.inputs.get(position)?.nativeElement.blur();
        }, 0);

        // Store coordinates of selected stop in the main trip data and name of stop
        this.tripData.points[position].lat = stop.lat;
        this.tripData.points[position].lng = stop.lng;
        this.tripData.points[position].placeName = stop.name;

        // Trip point at given position might have been tracking the current location
        this.tripPointsWithLocationTracking.delete(position);

        // Redraw markers with new point with the stop coordinates
        this.redrawTripMarkers();
    }

    // Function called when the content of a trip point input is cleared
    public clearTripPoint(position: number): void {

        // Set the value of the corresponding form input control to empty string
        this.pointControls.controls[position].setValue("");

        // Clear the lat, lng coordinates at the give position
        this.tripData.points[position] = {};
        this.tripPointsWithLocationTracking.delete(position);

        // Redraw the trip markers due to change
        this.redrawTripMarkers();
    }

    // Function for checking if the contents of the form contain all necessary trip data for request
    public isFormValid(): boolean {

        // Check if at least one global mode is selected
        if (!Object.values(this.tripData.modes.global).includes(true))
            return false;

        // Check if at least one mode is selected for each trip section
        for (const section of this.tripData.modes.sections) {
            if (!Object.values(section).includes(true))
                return false;
        }

        // Check if all points have defined coordinates
        for (const point of this.tripData.points) {
            if (point.lat === undefined || point.lng === undefined)
                return false;
        }
        
        // Check if the date and time of the trip are set in the form 
        if (this.tripData.datetime.tripDate === "" || this.tripData.datetime.tripTime === "")
            return false;

        // Check if the return date and time of the trip are set in the form in case the return trip is active
        if (this.tripData.return.active && (this.tripData.return.tripDate === "" || this.tripData.return.tripTime === ""))
            return false;

        // Check if points between all sections are valid
        if (this.invalidModesIdx !== null)
            return false;

        return true;
    }

    // Function called when the user opens (focuses) one of the trip point inputs
    public pointInputFocused(position: number) {

        // Clear the point form control and trip point, redraw markers
        this.pointControls.at(position).setValue("");
        this.tripData.points[position] = {};        
        this.redrawTripMarkers();
    }

    // Function called when the submit button is clicked in the trip form
    public tripRequestSubmitted(): void {

        // Turn on overlay loading screen
        this.msgService.turnOnLoadingScreenWithoutPercentage();

        // If theres some points that have an undefined place name, add a small delay, there might be an ongoing request for the name
        if (this.tripData.points.some(point => point.placeName === undefined)) {
            setTimeout(() => {
                this.tripSubmit.emit(this.tripData);
            }, 400);
        }
        else
            this.tripSubmit.emit(this.tripData);

    }

    // Function checking the array with selected modes for each section for validity (separated car sections)
    private checkSeperatedCarSections() {
        let carValid = true;
        const sectionModes = this.tripData.modes.sections;

        // Iterate over the modes in all sections
        for (let i = 0; i < sectionModes.length; i++) {

            // The section has car selected as a possible mode
            if (sectionModes[i].car) {

                // If the car cannot be used here, set the invalid modes index (displays warning message)
                if (!carValid) {
                    this.invalidModesIdx = i;
                    return;
                }

                // Make the car invalid for next sections if this section might use a car together with another mode
                else if (sectionModes[i].publicTransport || sectionModes[i].walk)
                    carValid = false;
            }

            // If the previous section already uses the car, and the current one isnt, car will no longer be valid
            else if (i !== 0 && sectionModes[i - 1].car)
                carValid = false;
        }

        this.invalidModesIdx = null;
    }

    private updateSectionModes(mode: TransportMode): void {

        // If only one global mode is now selected, select it for all sections also
        if (this.selectedModesCount === 1) {
            if (this.tripData.modes.global.publicTransport)
                this.tripData.modes.sections = this.tripData.modes.sections.map(() => ({ publicTransport: true, car: false, walk: false }));
            else if (this.tripData.modes.global.car)
                this.tripData.modes.sections = this.tripData.modes.sections.map(() => ({ publicTransport: false, car: true, walk: false }));
            else
                this.tripData.modes.sections = this.tripData.modes.sections.map(() => ({ publicTransport: false, car: false, walk: true }));

            return;
        }

        const global = this.tripData.modes.global[mode]; // Store new value of toggled mode (less member access in loop)
        for (let i = 0; i < this.tripData.modes.sections.length; i++) 
            this.tripData.modes.sections[i][mode] = global;
    }

    // Function for fetching the current users device location
    private fetchCurrentLocation(tripPointPosition?: number): void {

        // Start blinking on location button
        this.locationStatus = "searching";

        // Start location tracking for the given point
        if (tripPointPosition !== undefined) 
            this.tripPointsWithLocationTracking.add(tripPointPosition);

        // Begin watching for current position updates (15 sec timeout)
        this.locationWatchId = navigator.geolocation.watchPosition(
            position => {
                this.currentLocationUpdate(position);
            }, 
            error => {
                this.handleLocationError(error);
            },
            {
                timeout: 15000
            }
        );
    }

    // Function updating state due to success in fetching the current device location
    private currentLocationUpdate(position: GeolocationPosition) {
        this.locationStatus = "enabled";
        this.mapService.clearLayer("currentLocation");
        this.mapService.addToLayer({
            layerName: "currentLocation",
            type: "location",
            focus: false,
            latLng: [{ lat: position.coords.latitude, lng: position.coords.longitude }],
            color: "base",
            interactive: false,
            hoover: false,
            metadata: {},
        });

        // Store acquired location coordinates
        this.currentLocation.lat = position.coords.latitude;
        this.currentLocation.lng = position.coords.longitude;
        
        // Update coordinates of any trip points that are currently tracking the location
        this.tripPointsWithLocationTracking.forEach(pointIdx => {
            this.tripData.points[pointIdx] = { ...this.currentLocation };
            this.tripData.points[pointIdx].placeName = this.translate.instant("planner.form.myLocation");
        })

        // Redraw markers of trip points currently tracking the location if there are any
        if (this.tripPointsWithLocationTracking.size > 0)
            this.redrawTripMarkers();
    }

    // Function updating state due to error in fetching current location
    private handleLocationError(error: GeolocationPositionError) {

        // Display toast with message based on error type
        if (error.code === error.PERMISSION_DENIED)
            this.msgService.showMessage("info", "UIMessagesService.toasts.locationDenied.head", "UIMessagesService.toasts.locationDenied.body");
        else if (error.code === error.POSITION_UNAVAILABLE)
            this.msgService.showMessage("info", "UIMessagesService.toasts.locationUnavailable.head", "UIMessagesService.toasts.locationUnavailable.body");
        else
            this.msgService.showMessage("info", "UIMessagesService.toasts.locationTimeout.head", "UIMessagesService.toasts.locationTimeout.body");
        
        this.locationStatus = "disabled";
        this.currentLocation = {};

        // Clear trip points which have current location selected
        this.pointControls.controls.forEach((control, index) => {
            if (control.value === "Moje poloha" || control.value === "My location") {
                control.setValue("");
                this.tripData.points[index] = {};

                // Remove points from location tracking
                this.tripPointsWithLocationTracking.delete(index);
            }
        });
        
        // Some trip points might have been cleared, redraw markers
        this.redrawTripMarkers();
    }

    // Create observable for filtered stops for specific input given by 'position'
    private createFilteredStops(position: number): Observable<Stop[]> {

        // The maximum number of autocomplete suggestions to return
        const MAX_SUGGEST = 20;

        // Subscribe to the valueChanges event of that point control
        return this.pointControls.at(position).valueChanges.pipe(

            // Always initialize form control with empty string for autocomplete
            startWith(''),

            // Wait 200ms after user stops typing for better performance
            debounceTime(200),

            // value is the current value in the user input
            map(value => {

                const search = 
                    (value ?? '')
                    .toLowerCase()                      // Put value into lowercase
                    .normalize("NFD")                   // Split letters and softeners (ř, č, š, ...)
                    .replace(/[\u0300-\u036f]/g, "")    // Remove softeners with empty string
                    .trim()                             // Trim leading and trailing whitespace
                    .replace(/[.,]/g, "");              // Remove commas and periods

                // Only autocomplete with at least two characters 
                if (search.length < 2) 
                    return [];

                // Prepare two seperate array for stops that match with prefix and stops that match with non-prefix substrings
                let prefixMatches: Stop[] = [];
                let substringMatches: Stop[] = [];

                for (const stop of this.stops()) {

                    // Adjust the stop name string in same way as input search
                    const lowercase = 
                        stop.name
                        .toLowerCase()
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .trim()
                        .replace(/[.,]/g, "");

                    // Add to array based on match
                    if (lowercase.startsWith(search))
                        prefixMatches.push(stop);
                    else if (lowercase.includes(search))
                        substringMatches.push(stop);

                    // If theres 20 prefix matches already, iterating can stop
                    if (prefixMatches.length >= MAX_SUGGEST)
                        break;
                }

                // Combine the two arrays together, prefix matches will be first in order, return only first 20
                return prefixMatches
                    .concat(substringMatches)
                    .slice(0, MAX_SUGGEST);
            })
        );
    }

    // Function calling the map service when the trip point markers need to be redrawn due to updates  
    private redrawTripMarkers(): void {

        // Clear the old markers
        this.mapService.clearLayer("tripPoints");

        // Add new layer if it doesnt exist yet
        this.mapService.addNewLayer({
            name: "tripPoints",
            layer: undefined,
            palette: {},
            paletteItemName: "",
        });

        // Send the trip point coordinates to the map service for marker redraw
        this.mapService.redrawLayer({ layerName: "tripPoints", data: this.tripData.points });
    }
}
