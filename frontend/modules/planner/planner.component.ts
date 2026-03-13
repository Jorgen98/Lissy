/*
 * File: planner.component.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 * 
 * Main class component for the planner module.
 */

import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { MapComponent } from '../../src/app/map/map.component';
import { ImportsModule } from '../../src/app/imports';
import { TripFormComponent } from './components/trip-form/trip-form.component';
import { ItineraryComponent } from './components/itinerary/itinerary.component';
import { MapService } from '../../src/app/map/map.service';
import { APIService } from '../../src/app/services/api';
import { UIMessagesService } from '../../src/app/services/messages';
import { Stop } from './types/Stop';
import { TripData } from './types/TripData';
import { Subscription } from 'rxjs';
import { MarkerType } from './types/MarkerType';
import { TripOption, TripSectionLeg } from './types/TripOption';
import { modeColors } from './utils/modeColors';
import { TripDataExtended } from './types/TripDataExtended';
import { 
    Component, 
    AfterViewInit, 
    ViewChild, 
    ElementRef, 
    HostListener,
    OnInit,
    OnDestroy
} from '@angular/core';

@Component({
    selector: 'app-planner',
    imports: [ImportsModule, MapComponent, TripFormComponent, ItineraryComponent],
    templateUrl: './planner.component.html',
    styleUrl: './planner.component.css',
})
export class PlannerModule implements AfterViewInit, OnInit, OnDestroy {

    // JSON config file
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;

    // Sidebar module choice
    public moduleFocus: Number = 0;

    // References to SVG images used as cursors when a new stop is being selected in the map
    @ViewChild('startCursor') startCursorRef!: ElementRef<SVGElement>;
    @ViewChild('midpointCursor') midpointCursorRef!: ElementRef<SVGElement>;
    @ViewChild('endCursor') endCursorRef!: ElementRef<SVGElement>;

    // Type of the currently active marker cursor, null if not currently selected
    private markerType: MarkerType | null = null;

    // Position of the current active marker cursor in the trip form, null if not currently selected
    private markerPosition: number | null = null;

    // Flag for synchronization between onClick() and markerClick() methods
    // markerClick is used for setting the cursor, onClick is used for clearing it if a click happens oustide the leaflet map
    // onClick needs to not clear the cursor right after markerClick sets it
    private clickSyncFlag: boolean = false;

    // List of all stops in the transport system with coordinates and names
    public allStops: Stop[] = []; 

    // Variable holding a subscribtion to map click events from the map service
    private mapClickSub: Subscription;

    // Coordinates of a map click and the selected marker position, used as an output variable to the trip form component
    public clickedCoordsWithMarker: { coords: L.LatLng, position: number } | null = null;

    // List of trip options received from the backend
    public tripOptions: TripOption[] | null = null;

    // Maximum walking distance from user preferences input
    public selectedWalkDistanceKm = 5;  // Default value 5 km
    public walkDistanceUnlimited = false;   // Whether the walking distance should be limited

    // Average walking speed from user preferences input
    public selectedWalkingSpeedKmh = 5.0;

    // Which modes for public transports are allowed by the user for planning in preferences
    public allowedPublicTransportModes = {
        bus: true,
        trolleybus: true,
        tram: true,
        train: true,
        ferry: true,
    }

    // Changes to these variables notify child components if they should give up space by going into a more compact mode
    // Or they can take up more space
    public formForceAction: "open" | "close" | null = null;
    public itineraryForceAction: "open" | "close" | null = null;

    constructor(
        private mapService: MapService,
        private apiService: APIService,
        private msgService: UIMessagesService
    ) {

        // Subscribe to map mouse clicks
        this.mapClickSub = this.mapService.mapClickObj.subscribe(coords => this.mapClicked(coords));
    }

    ngAfterViewInit(): void {
        // Show map scale
        this.mapService.configureMapFeatures({ showScale: true });
    }

    async ngOnInit(): Promise<void> {

        // Check if API is running and connected
        if(!await this.apiService.isConnected()) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.dbConnectError.head', 'UIMessagesService.toasts.dbConnectError.body');
            return;
        }

        // Turn on loading screen
        this.msgService.turnOnLoadingScreenWithoutPercentage();

        // Get list of all stops for autocomplete
        const stops = await this.apiService.genericGet(`${config.apiPrefix}/allStops`) as { stops: Stop[] } | null;
        if (!stops) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.stopsUnavailable.head', 'UIMessagesService.toasts.stopsUnavailable.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        this.allStops = stops.stops;

        // Turn off loading screen after initialization is done
        this.msgService.turnOffLoadingScreen();
    }

    ngOnDestroy(): void {

        // Cancel the map click event subscribtion on component destroy
        this.mapClickSub.unsubscribe();
    }

    // Function called when a marker in the form is clicked
    public markerClick(marker: { type: MarkerType, position: number }): void {

        // Do nothing if the cursor is already a marker
        if (this.markerType)
            return;

        // Set the flag so onClick method doesnt clear the new cursor image
        this.clickSyncFlag = true;

        // Store the state of the cursor and marker position in trip form
        this.markerType = marker.type;
        this.markerPosition = marker.position;

        // Hide classic cursor on the form and leaflet map elements
        this.setCursor('none');

        // Select new cursor image based on which marker was clicked in the form
        const cursor = this.getCursorImageElement();

        // Make cursor visible
        cursor.style.zIndex = '500';
        cursor.style.display = 'inline';
    }

    // Function called when a trip is submitted from the form
    public async tripSubmit(tripData: TripData): Promise<void> {

        // Clear trip options when a new trip is being requested
        this.tripOptions = null;
        this.mapService.clearLayer('routes');

        // Turn on loading screen
        this.msgService.turnOnLoadingScreenWithoutPercentage();

        // Check if API is running and connected
        if(!await this.apiService.isConnected()) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.dbConnectError.head', 'UIMessagesService.toasts.dbConnectError.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        // Convert time from form format to ISO string in UTC
        const isoDatetime = new Date(`${tripData.datetime.tripDate}T${tripData.datetime.tripTime}`).toISOString();

        // Add user preferences to trip data from form
        const tripDataPreferences: TripDataExtended = {
            ...tripData,
            datetime: {
                tripDatetime: isoDatetime,
                datetimeOption: tripData.datetime.datetimeOption,
            },
            preferences: {
                walk: {
                    maxDistance: this.walkDistanceUnlimited ? null : this.selectedWalkDistanceKm * 1000,    // Convert to meters
                    avgSpeed: this.selectedWalkingSpeedKmh / 3.6    // Convert to m/s
                },
                publicTransport: {
                    allowedModes: this.allowedPublicTransportModes
                }
            }
        }

        // Call backend endpoint for planning trip with emitted trip data from the form
        const tripOptions = await this.apiService.genericGet(`${config.apiPrefix}/planTrip`, { data: JSON.stringify(tripDataPreferences) }) as TripOption[] | null;
        if (!tripOptions || tripOptions.length === 0) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.tripsNotFound.head', 'UIMessagesService.toasts.tripsNotFound.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        // Turn off loading screen after routes are retrieved
        this.msgService.turnOffLoadingScreen();

        // Force collapse the form and expand the itinerary with all options
        this.formForceAction = "close";
        this.itineraryForceAction = "open";
        this.resetComponentNotifs();

        // Store the backend call result in the frontend planner for displaying
        this.tripOptions = tripOptions;

        // Render the first trip option
        this.renderTrip(0);
    }

    // Notification from the itinerary that the detail of on option is getting opened
    public itineraryForceOpenDetail() {

        // Force collapse the form, make space for itinerary
        this.formForceAction = "close";
        this.resetComponentNotifs();
    }

    // Notification from the form that its either collapsing or uncollapsing
    public formCollapseAction(action: "collapse" | "uncollapse") {

        // Notify itinerary to compact/expand based on action from form
        if (action === "uncollapse")
            this.itineraryForceAction = "close";
        else
            this.itineraryForceAction = "open";

        this.resetComponentNotifs();
    }

    // Function called when the mouse is moved (mousemove event happens)
    @HostListener('document:mousemove', ['$event'])
    public onMouseMove(event: MouseEvent): void {

        // If the cursor is not currently a marker, do nothing
        if (!this.markerType)
            return;

        // Update position of the SVG on the cursor
        const cursor = this.getCursorImageElement();
        cursor.style.left = (event.clientX - 12) + 'px';
        cursor.style.top = (event.clientY - 30) + 'px';
    }

    // Function called when any key is pressed (keyboard event happens)
    @HostListener('document:keydown', ['$event'])
    public onKeyDown(event: KeyboardEvent): void {

        // If the cursor is not currently a marker, do nothing
        if (!this.markerType)
            return;

        // Continue only if the pressed key was a backspace or escape to stop marker selecting
        if (event.key !== "Escape" && event.key !== "Backspace")
            return;

        this.resetCursor();
    }

    // Function called when the mouse is clicked (pointer event happens)
    @HostListener('document:click', ['$event'])
    public onClick(event: PointerEvent): void {

        // If the cursor is not currently a marker, do nothing
        if (!this.markerType)
            return;

        // If the sync flag is currently on, the cursor was just changed to a marker in markerClicked()
        if (this.clickSyncFlag) {
            this.clickSyncFlag = false;

            // Initialize position of the SVG on the cursor
            const cursor = this.getCursorImageElement();
            cursor.style.left = (event.clientX - 12) + "px";
            cursor.style.top = (event.clientY - 30) + "px";
            return;
        }

        // Get the element which the click occured on
        const clickedElement = event.target as HTMLElement;
        if (clickedElement.id !== "map")
            this.resetCursor();
    }

    // Function called when the max walk distance input is blurred
    public walkDistanceBlur(): void {

        // Check for empty value and refill with default
        if (this.selectedWalkDistanceKm === null)
            this.selectedWalkDistanceKm = 5;
    }

    // Function called when the average walk speed input is blurred
    public walkSpeedBlur(): void {

        // Check for empty value and refill with default
        if (this.selectedWalkingSpeedKmh === null)
            this.selectedWalkingSpeedKmh = 5.0;
    }

    public clearItinerary(): void {
        this.tripOptions = null;
        this.mapService.clearLayer('routes');
    }

    // Function rendering a single trip on the leaflet map using polylines
    public renderTrip(index: number): void {

        if (this.tripOptions === null)
            return;

        // Get trip from the trip options list
        const trip = this.tripOptions[index];

        // Reset routes layer before rendering
        this.mapService.clearLayer('routes');
        this.mapService.addNewLayer({ name: 'routes', palette: {}, layer: undefined, paletteItemName: '' });
    
        // Iterate through each leg and add it to the map layer with color given by GTFS or hardcoded for specific modes
        trip.sections.forEach(section => {
            section.legs.forEach((leg, index) => {
                const bgColor = this.getLegColor(leg);
                this.mapService.addToLayer({
                    layerName: "routes",
                    type: "route",
                    focus: index === section.legs.length - 1,
                    latLng: leg.points,
                    color: "provided",
                    metadata: {
                        color: bgColor,
                        dashed: leg.mode === "CAR" || leg.mode === "WALK",

                        // For good contrast the color of the mode image is either dark or white based on the background color
                        modeImg: `${leg.mode.toLowerCase()}-${this.isColorLight(bgColor) ? 'dark' : 'white'}.svg`,

                        // Flag if this leg is the last leg, used so the full route can be focused onto in the map
                        isLastLeg: index === section.legs.length - 1,
                    },
                    interactive: true,
                    hoover: false,
                });
            });
        });
    }

    // Function for extra walking preferences module switch
    public switchWalkingPreferencesModuleVisibility() {
        if (this.moduleFocus !== 1)
            this.moduleFocus = 1;
        else
            this.moduleFocus = 0;
    }

    // Function for extra public transport preferences module switch
    public switchPublicTransportPreferencesModuleVisibility() {
        if (this.moduleFocus !== 2)
            this.moduleFocus = 2;
        else
            this.moduleFocus = 0;
    }

    private resetComponentNotifs() {

        // setTimout forces the change to run in the next change detection cycle
        // This allows for the changes to these variables that happened right before this to actually get detected
        setTimeout(() => {
            this.formForceAction = null;
            this.itineraryForceAction = null;
        });
    }

    // Function determining if the passed in hex color is light or dark
    private isColorLight(hex: string): boolean {

        // Adjust to route color switching from black to white in map.component
        if (hex === "#000000")
            return true;

        // Get individual RGB components
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        // Decide according to equivalent grayscale color
        const luminance = r * 0.299 + g * 0.587 + b * 0.114;
        return luminance > 128;
    }

    private resetCursor(): void {

        // Reset the original cursor values given by .css files
        this.setCursor('');

        // Select svg cursor element based on the previously selected marker
        const cursor = this.getCursorImageElement();

        // Clear the cursor state
        cursor.style.display = 'none';
        this.markerType = null;
        this.markerPosition = null;
    }

    private setCursor(value: string): void {
        const map = document.querySelector('#map') as HTMLElement;
        const form = document.querySelector('.form') as HTMLElement;
        const sidebar = document.querySelector('.side-control') as HTMLElement;
        map.style.cursor = value;
        form.style.cursor = value;
        sidebar.style.cursor = value;
        form.querySelectorAll('*').forEach(el => {
            (el as HTMLElement).style.cursor = value;
        });
    }

    // Function returning a SVG element that should be used as the new cursor for trip point selection
    private getCursorImageElement(): SVGElement {
        if (this.markerType === "start")
            return this.startCursorRef.nativeElement;
        else if (this.markerType === "end")
            return this.endCursorRef.nativeElement;
        return this.midpointCursorRef.nativeElement;
    }

    // Function called when a mouse click happens on the leaflet map
    private mapClicked(coords: L.LatLng): void {

        // If the marker position is currently set, set the clickedCoordsWithMarker to the click coordinates and current marker position
        // This will be emitted to the trip form component
        if (this.markerPosition !== null){
            this.clickedCoordsWithMarker = { coords, position: this.markerPosition };

            // Clear the marker cursor
            this.resetCursor();
        }
    }

    // Function retrieving the color of the leg based on the mode and availability from GTFS
    private getLegColor(leg: TripSectionLeg): string {

        // If the leg doesnt have a transport system route defined, or the color is not provided, get hardcoded value
        if (leg.route === null || leg.route.color === null)
            return modeColors[leg.mode];

        // Otherwise return formatted hex color
        return `#${leg.route.color}`; 
    }
}
