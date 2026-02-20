/*
 * File: trip-form.component.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Class for the trip form component used in the planner module.
 */

import { Component, AfterViewInit, OnDestroy, output, input, OnInit } from '@angular/core';
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
import { debounceTime, map, startWith, Observable } from 'rxjs';
import { 
    CdkDrag, 
    CdkDropList, 
    CdkDragDrop, 
    moveItemInArray, 
    CdkDragHandle, 
    CdkDragPreview 
} from '@angular/cdk/drag-drop';

@Component({
    selector: 'trip-form',
    imports: [
        ImportsModule, 
        CdkDrag, 
        CdkDropList, 
        CdkDragHandle, 
        CdkDragPreview, 
        FormsModule, 
        MatAutocompleteModule, 
        ReactiveFormsModule, 
        AsyncPipe
    ],
    templateUrl: './trip-form.component.html',
    styleUrl: './trip-form.component.css',
})
export class TripFormComponent implements AfterViewInit, OnDestroy, OnInit {
    
    // Whether the main trip input for is currently collapsed
    public formCollapsed: Boolean = false;

    // Object containing information about the trip currently in the form
    public tripData: TripData = {
        points: [{}, {}],           // Coordinates of points on the trip, start off empty/undefined
        selectedModesGlobal: {      // Modes globally selected for planning
            publicTransport: true,
            car: true, 
            walk: false,
        },
        sectionModes: [],           // Modes selected between adjacent midpoints
        returnTripActive: false,    // Whether the return trip is active
    }

    // Status of current location availability
    public locationStatus: LocationStatus = "default";

    // Current location coordinates
    private currentLocation: { lat?: number, lng?: number } = {};

    // Output for notifying the parent planner component that a marker has been clicked in the form to select point in the map
    public markerClick = output<MarkerType>();

    // Id for current location watch
    private locationWatchId: number = -1; 

    // Array of transport system stops received from the backend, input from the parent component
    public stops = input<Stop[]>([]);

    // Each form input has its own list of stops that match the substring entered into the input element for autocomplete
    // Observable so the autocomplete can be updated while typing
    public filteredStopsArray: Observable<Stop[]>[] = []

    // Dynamic array of controls for individual trip point inputs
    public pointControls = new FormArray<FormControl<string>>([
        new FormControl('', { nonNullable: true }),
        new FormControl('', { nonNullable: true })
    ]);

    // Getter for number of globally selected transport modes
    get selectedModesCount(): number {
        return Number(this.tripData.selectedModesGlobal.publicTransport) 
            + Number(this.tripData.selectedModesGlobal.car)
            + Number(this.tripData.selectedModesGlobal.walk);
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
    }

    ngAfterViewInit(): void {

        // Get date and time inputs
        const dateInput = document.getElementById("dateInput") as HTMLInputElement;
        const timeInput = document.getElementById("timeInput") as HTMLInputElement

        // Get current date and time and get individual elements
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        // Set default date and time value in form to now
        dateInput.value = `${year}-${month}-${day}`;
        timeInput.value = `${hours}:${minutes}`;
    }

    ngOnDestroy(): void {

        // Clear watching for current location and remove existing layers
        navigator.geolocation.clearWatch(this.locationWatchId);
        this.mapService.removeLayer("currentLocation");
        this.mapService.removeLayer("tripPoints");
    }

    // Function called when a transport mode is toggled as on/off
    // If index is set, the transport mode was set/unset between adjacent points in a trip section, otherwise globally
    public modeToggled(mode: TransportMode, index?: number): void {
        if (index !== undefined)
            this.tripData.sectionModes[index][mode] = !this.tripData.sectionModes[index][mode];
        else {
            this.tripData.selectedModesGlobal[mode] = !this.tripData.selectedModesGlobal[mode];

            // Adjust section modes if the global modes were edited
            this.updateSectionModes(mode);
        }
    }

    // Function called when a point is dropped after dragged
    public pointDropped(event: CdkDragDrop<string[]>): void {

        // Reorder the necessary arrays after drag and drop movement is finished
        moveItemInArray(this.tripData.points, event.previousIndex, event.currentIndex);
        moveItemInArray(this.filteredStopsArray, event.previousIndex, event.currentIndex);
        moveItemInArray(this.pointControls.controls, event.previousIndex, event.currentIndex);
    }

    // Function called when the button to reverse the trip points is clicked
    public reverseTripPoints(): void {

        // Reverse content of all necessary arrays
        this.tripData.points.reverse();
        this.filteredStopsArray.reverse();
        this.pointControls.controls.reverse();
    }

    // Function for fetching the current location on user request
    public locationClicked(tripPointPosition?: number): void {

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

            // Add marker at the current location
            this.addMarkerToMap({ lat: this.currentLocation.lat!, lng: this.currentLocation.lng! }, tripPointPosition);
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
                }
            });
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
            this.tripData.sectionModes[0] = { ...this.tripData.selectedModesGlobal };
            this.tripData.sectionModes[1] = { ...this.tripData.selectedModesGlobal };
        }

        // Copy global selected modes to the new created section
        else 
            this.tripData.sectionModes.splice(position - 1, 0, { ...this.tripData.selectedModesGlobal });
    }

    // Function deleting trip midpoint from the form
    public removeMidpoint(position: number): void {

        // Remove point from the trip data, its form input control and the array of filtered stops
        this.tripData.points.splice(position, 1);
        this.pointControls.removeAt(position);
        this.filteredStopsArray.splice(position, 1);

        // If the number of points reaches 2, clear the section modes
        if (this.tripData.points.length == 2)
            this.tripData.sectionModes = [];

        // Otherwise remove the section modes between deleted point and the point below it
        else
            this.tripData.sectionModes.splice(position, 1);
    }

    // Function called when a stop has been selected from autocomplete
    // 'stop' is the selected stop and 'position' holds which trip point the stop was selected for
    public stopSelected(stop: Stop, position: number) {

        // Store coordinates of selected stop in the main trip data 
        this.tripData.points[position].lat = stop.lat;
        this.tripData.points[position].lng = stop.lng;

        // Add marker to the map for the selected stop
        this.addMarkerToMap(stop, position);
    }

    private updateSectionModes(mode: TransportMode): void {

        // If only one global mode is now selected, select it for all sections also
        if (this.selectedModesCount === 1) {
            if (this.tripData.selectedModesGlobal.publicTransport)
                this.tripData.sectionModes = this.tripData.sectionModes.map(() => ({ publicTransport: true, car: false, walk: false }));
            else if (this.tripData.selectedModesGlobal.car)
                this.tripData.sectionModes = this.tripData.sectionModes.map(() => ({ publicTransport: false, car: true, walk: false }));
            else
                this.tripData.sectionModes = this.tripData.sectionModes.map(() => ({ publicTransport: false, car: false, walk: true }));

            return;
        }

        const global = this.tripData.selectedModesGlobal[mode]; // Store new value of toggled mode (less member access in loop)
        for (let i = 0; i < this.tripData.sectionModes.length; i++) 
            this.tripData.sectionModes[i][mode] = global;
    }

    // Function for fetching the current users device location
    private fetchCurrentLocation(tripPointPosition?: number): void {

        // Start blinking on location button
        this.locationStatus = "searching";

        // Begin watching for current position updates (15 sec timeout)
        this.locationWatchId = navigator.geolocation.watchPosition(

            // Clear possible previous current positions and display new one on the map
            position => {
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
                
                // If the current position is being fetched as a result of it being selected as a trip point, store it for that point
                if (tripPointPosition !== undefined){
                    this.tripData.points[tripPointPosition] = this.currentLocation;

                    // Add marker at current location
                    this.addMarkerToMap({ lat: this.currentLocation.lat, lng: this.currentLocation.lng }, tripPointPosition);
                }
            }, 

            // Show info toast in case of error and disable current position
            error => {
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
                    }
                });
            },
            {
                timeout: 15000
            }
        );
    }

    // Create observable for filtered stops for specific input given by 'position'
    private createFilteredStops(position: number): Observable<Stop[]> {

        // Subscribe to the valueChanges event of that point control
        return this.pointControls.at(position).valueChanges.pipe(

            // Always initialize form control with empty string for autocomplete
            startWith(''),

            // Wait 200ms after user stops typing for better performance
            debounceTime(200),

            // value is the current value in the user input
            map(value => {

                // Get the value in lowercase
                const search = (value ?? '').toLowerCase();

                // Only autocomplete with at least two characters 
                if (search.length < 2) 
                    return [];
                
                // Return stops whose names (lowercase) contain the substring geiven by user input
                // Only get first 20 for performance
                return this.stops()
                    .filter(stop => stop.name.toLowerCase().includes(search))
                    .slice(0, 20);
            })
        );
    }

    // Function adding a marker to the leaflet map at given position in the trip
    private addMarkerToMap(stop: Omit<Stop, "name">, position: number) {

        // Add map layer for markers if it hasnt been added before
        // Wont be readded repearedly, map service does a check for existence 
        this.mapService.addNewLayer({
            name: "tripPoints",
            layer: undefined,
            palette: {},
            paletteItemName: "",
        });

        // Add a marker to the new/existing layer for the trip point
        this.mapService.addToLayer({
            layerName: "tripPoints",
            type: "tripPoint",
            focus: false,
            latLng: [{ lat: stop.lat, lng: stop.lng }],
            color: "base",
            metadata: {
                pointType: position === 0 ? "start" : (position === this.tripData.points.length - 1 ? "end" : "midpoint"),
            },
            interactive: false,
            hoover: false,
        });
    }
}
