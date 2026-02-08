import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { TransportMode } from '../../types/TransportMode';
import { TranslateService } from '@ngx-translate/core';
import { ImportsModule } from '../../../../src/app/imports';
import { LocationStatus } from '../../types/LocationStatus';
import { UIMessagesService } from '../../../../src/app/services/messages';
import { MapService } from '../../../../src/app/map/map.service';
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

    // Whether a return trip has been selected
    public returnTripActive: Boolean = false;

    // Modes currently selected for trip planning
    public modesSelected: Record<TransportMode, Boolean> = {
        publicTransport: true,
        car: true,
        walk: false,
    };

    // List with the current values in point/midpoint inputs in the form
    public tripPoints: String[] = ["", ""];

    // Status of current location availability
    public locationStatus: LocationStatus = "default";

    // Id for current location watch
    private locationWatchId: number = -1; 

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
    public modeToggled(mode: TransportMode): void {
        this.modesSelected[mode] = !this.modesSelected[mode];
    }

    // Function called when a point is dropped after dragged
    public pointDropped(event: CdkDragDrop<string[]>) {

        // Reorder the tripPoints array
        moveItemInArray(this.tripPoints, event.previousIndex, event.currentIndex);
    }

    // Function for fetching the current users device location
    private fetchCurrentLocation() {

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

    // Function for fetching the current location on user request
    public locationClicked() {

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
}
