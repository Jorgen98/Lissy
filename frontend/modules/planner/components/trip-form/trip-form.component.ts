import { Component, AfterViewInit, OnDestroy, output } from '@angular/core';
import { TransportMode } from '../../types/TransportMode';
import { TranslateService } from '@ngx-translate/core';
import { ImportsModule } from '../../../../src/app/imports';
import { LocationStatus } from '../../types/LocationStatus';
import { UIMessagesService } from '../../../../src/app/services/messages';
import { MapService } from '../../../../src/app/map/map.service';
import { TripData } from '../../types/TripData';
import { MarkerType } from '../../types/MarkerType';
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
    imports: [ImportsModule, CdkDrag, CdkDropList, CdkDragHandle, CdkDragPreview],
    templateUrl: './trip-form.component.html',
    styleUrl: './trip-form.component.css',
})
export class TripFormComponent implements AfterViewInit, OnDestroy {
    
    // Whether the main trip input for is currently collapsed
    public formCollapsed: Boolean = false;

    // Object containing information about the trip currently in the form
    public tripData: TripData = {
        points: ["", ""],           // Names of points on the trip
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

    // Output for notifying the parent planner component that a marker has been clicked in the form to select point in the map
    public markerClick = output<MarkerType>();

    // Id for current location watch
    private locationWatchId: number = -1; 

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

        // Clear watching for current location and remove current location layer
        navigator.geolocation.clearWatch(this.locationWatchId);
        this.mapService.removeLayer("currentLocation");
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

        // Reorder the tripPoints array
        moveItemInArray(this.tripData.points, event.previousIndex, event.currentIndex);
    }

    // Function for fetching the current location on user request
    public locationClicked(): void {

        // If the location hasnt been fetched before, add a new layer on the map and fetch
        if (this.locationStatus === "default") {
            this.mapService.addNewLayer({
                name: "currentLocation",
                layer: undefined,
                palette: {},
                paletteItemName: "",
            });
            this.fetchCurrentLocation();
        }

        // If the location is currently shown, disable it, clear watch and layer
        else if (this.locationStatus === "enabled") {
            this.locationStatus = "disabled";
            navigator.geolocation.clearWatch(this.locationWatchId);
            this.mapService.clearLayer("currentLocation");
        }

        // Refetch in case of previous user disable or error
        else if (this.locationStatus === "disabled")
            this.fetchCurrentLocation();
    }

    // Function adding a new trip midpoint to the form
    public addMidpoint(position: number): void {

        // Add new point with empty name at given position
        this.tripData.points.splice(position, 0, '');

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

        // Remove point at given position
        this.tripData.points.splice(position, 1);

        // If the number of points reaches 2, clear the section modes
        if (this.tripData.points.length == 2)
            this.tripData.sectionModes = [];

        // Otherwise remove the section modes between deleted point and the point below it
        else
            this.tripData.sectionModes.splice(position, 1);
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
    private fetchCurrentLocation(): void {

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
            },
            {
                timeout: 15000
            }
        );
    }
}
