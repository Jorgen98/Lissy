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
import { Subscription, Subject } from 'rxjs';
import { MarkerType } from './types/MarkerType';
import { TripOption, TripSectionLeg, TripSectionOption } from './types/TripOption';
import { modeColors } from './utils/modeColors';
import { TicketType, TripDataExtended } from './types/TripDataExtended';
import { FileUploadHandlerEvent, FileUploadModule } from 'primeng/fileupload';
import { TripSchema } from './schemas/TripSchema';
import { TranslateService } from '@ngx-translate/core';
import { TripHeaderComponent } from './components/trip-header/trip-header.component';
import { TripSortField } from './types/TripSortField';
import { PlannerConfig } from './types/PlannerConfig';
import { 
    MAX_WALK_DISTANCE_DEFAULT, 
    MAX_TRANSFERS_DEFAULT, 
    AVG_WALK_SPEED_DEFAULT, 
} from './utils/defaultSettingValues';
import { 
    Component, 
    AfterViewInit, 
    ViewChild, 
    ElementRef, 
    HostListener,
    OnDestroy
} from '@angular/core';

@Component({
    selector: 'app-planner',
    imports: [
        ImportsModule, 
        MapComponent, 
        TripFormComponent, 
        ItineraryComponent, 
        FileUploadModule,
        TripHeaderComponent
    ],
    templateUrl: './planner.component.html',
    styleUrl: './planner.component.css',
})
export class PlannerModule implements AfterViewInit, OnDestroy {

    // JSON config file
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;

    // Sidebar module choice
    public moduleFocus: Number = 0;

    // References to SVG images used as cursors when a new stop is being selected in the map
    @ViewChild('startCursor') startCursorRef!: ElementRef<SVGElement>;
    @ViewChild('midpointCursor') midpointCursorRef!: ElementRef<SVGElement>;
    @ViewChild('endCursor') endCursorRef!: ElementRef<SVGElement>;

    // Whether the device the planner is rendered on is a touchscreen device
    public isTouchDevice: boolean = false;

    // Index of the currently shown option on map, only used for mobile view
    public mobileShownOption: number | null = null;

    // Type of the currently active marker cursor, null if not currently selected
    public markerType: MarkerType | null = null;

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

    // Reverse geocoded place name and position in the trip form where it should go, used as an output variable to the trip form component
    public geocodedPlaceName: { name: string, position: number } | null = null;

    // List of trip options received from the backend
    public tripOptions: TripOption[] | null = null;

    // Maximum walking distance from user preferences input
    public selectedWalkDistanceKm = MAX_WALK_DISTANCE_DEFAULT;
    public walkDistanceUnlimited = false;   // Whether the walking distance should be limited

    // Maximum number of transfers from user preferences input
    public selectedMaxNumberOfTransfers = MAX_TRANSFERS_DEFAULT;
    public maxNumberOfTransfersUnlimited = true;     // Whether the maximum number of transfers should be limited (unlimited by default)

    // Fuel price and average fuel consumption values from user settings with defaults
    // Actual default values are stored in DB, values are kept at 0 when loading them fails
    public selectedFuelConsumption = 0;
    public selectedFuelPrice = 0;

    // Average walking speed from user preferences input
    public selectedWalkingSpeedKmh = AVG_WALK_SPEED_DEFAULT;

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
    public formForceAction = new Subject<"open" | "close">();
    public itineraryForceAction = new Subject<"open" | "close">();

    // List of tickets the user can use for public transport
    public ticketOptions: { type: TicketType, label: string }[] = [
        { type: "base", label: "Základní" },
        { type: "discountedA", label: "Zlevněná A" },
        { type: "discountedB", label: "Zlevněná B" },
    ];
    public selectedTicketType: TicketType = this.ticketOptions[0].type;

    // Variable holding the width of the window, updates on resize
    public windowWidth: number = window.innerWidth; 
    @HostListener('window:resize', ['$event'])
    onResize(event: any) {
        this.windowWidth = event.target.innerWidth;
    }

    // Planner configuration from database
    private plannerConfig: PlannerConfig | null = null;

    constructor(
        private mapService: MapService,
        private apiService: APIService,
        private msgService: UIMessagesService,
        private translate: TranslateService
    ) {

        // Subscribe to map mouse clicks
        this.mapClickSub = this.mapService.mapClickObj.subscribe(coords => this.mapClicked(coords));
    }

    async ngAfterViewInit(): Promise<void> {

        // Store flag if the device is touchscreen or not
        this.isTouchDevice = window.matchMedia("(pointer: coarse)").matches;

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

        // Get planner configuration from DB
        const plannerConfig = await this.apiService.genericGet(`${config.apiPrefix}/getConfig`) as PlannerConfig | null;
        if (!plannerConfig) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.configUnavailable.head', 'UIMessagesService.toasts.configUnavailable.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        // Set default values for user settings and store the config
        this.selectedFuelConsumption = plannerConfig.avg_fuel_consumption_default;
        this.selectedFuelPrice = plannerConfig.fuel_price_default;
        this.plannerConfig = plannerConfig;

        // Show map scale
        this.mapService.configureMapFeatures({ showScale: true });

        // Show faint region outline with geometry from DB
        this.mapService.clearLayer('region');
        this.mapService.addNewLayer({ name: 'region', palette: {}, layer: undefined, paletteItemName: '' });
        this.mapService.addToLayer({
            layerName: 'region',
            type: 'regionBound',
            focus: false,
            latLng: [],
            color: "provided",
            metadata: {
                polygon: this.plannerConfig?.region_geom ?? undefined,
            },
            interactive: false,
            hoover: false,
        });

        // Turn off loading screen after initialization is done
        this.msgService.turnOffLoadingScreen();
    }

    ngOnDestroy(): void {

        // Cancel the map click event subscribtion on component destroy
        this.mapClickSub.unsubscribe();

        this.mapService.removeLayer('routes');
        this.mapService.removeLayer('returnTrip');
        this.mapService.removeLayer('stops');
        this.mapService.removeLayer('region');
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

        // Force collapse the form so the point can be selected easily on touch screen devices
        if (this.isTouchDevice)
            this.formForceAction.next("close");

        // Otherwise update the cursor
        else {

            // Hide classic cursor on the form and leaflet map elements
            this.setCursor('none');

            // Select new cursor image based on which marker was clicked in the form
            const cursor = this.getCursorImageElement();

            // Make cursor visible
            cursor.style.zIndex = '500';
            cursor.style.display = 'inline';
        }
    }

    // Function called when a trip is submitted from the form
    public async tripSubmit(tripData: TripData): Promise<void> {

        // Clear trip options when a new trip is being requested
        this.tripOptions = null;
        this.mapService.clearLayer('routes');
        this.mapService.clearLayer('returnTrip');
        this.mapService.clearLayer('stops');

        // Check if API is running and connected
        if(!await this.apiService.isConnected()) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.dbConnectError.head', 'UIMessagesService.toasts.dbConnectError.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        // Convert time from form format to ISO string in UTC
        const isoDatetime = new Date(`${tripData.datetime.tripDate}T${tripData.datetime.tripTime}`).toISOString();
        const isoDatetimeReturn = tripData.return.active 
            ? new Date(`${tripData.return.tripDate}T${tripData.return.tripTime}`).toISOString()
            : "";

        // Add user preferences to trip data from form
        const tripDataPreferences: TripDataExtended = {
            ...tripData,
            datetime: {
                tripDatetime: isoDatetime,
                datetimeOption: tripData.datetime.datetimeOption,
            },
            return: {
                active: tripData.return.active,
                datetime: isoDatetimeReturn,
                datetimeOption: tripData.return.datetimeOption
            },
            preferences: {
                walk: {
                    maxDistance: this.walkDistanceUnlimited ? null : this.selectedWalkDistanceKm * 1000,    // Convert to meters
                    avgSpeed: this.selectedWalkingSpeedKmh / 3.6    // Convert to m/s
                },
                publicTransport: {
                    allowedModes: this.allowedPublicTransportModes,
                    ticketType: this.selectedTicketType,
                    maxTransfers: this.maxNumberOfTransfersUnlimited ? null : this.selectedMaxNumberOfTransfers,
                },
                car: {
                    avgFuelConsumption: this.selectedFuelConsumption,
                    fuelPrice: this.selectedFuelPrice,
                }
            }
        }

        // Call backend endpoint for planning trip with emitted trip data from the form
        const tripOptions = await this.apiService.genericPost(`${config.apiPrefix}/planTrip`, tripDataPreferences) as TripOption[] | null;
        if (!tripOptions || tripOptions.length === 0) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.tripsNotFound.head', 'UIMessagesService.toasts.tripsNotFound.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        // Turn off loading screen after routes are retrieved
        this.msgService.turnOffLoadingScreen();

        // Store the backend call result in the frontend planner for displaying
        // Also convert dates to actual date object since they convert to strings in fetch responses
        this.tripOptions = tripOptions.map(option => ({
            ...option,
            endDatetime: new Date(option.endDatetime),
            startDatetime: new Date(option.startDatetime),
        }));

        // Implicitly sort by departure time
        this.sortTripOptions("startDatetime");

        // Force collapse the form and expand the itinerary with all options
        setTimeout(() => {
            this.formForceAction.next("close");
            this.itineraryForceAction.next("open");
        });

        // Render the first trip option
        this.renderTrip(0);
    }

    // Notification from the itinerary that the detail of on option is getting opened
    public itineraryForceOpenDetail() {

        // Force collapse the form, make space for itinerary
        this.formForceAction.next("close");
    }

    // Notification from the form that its either collapsing or uncollapsing
    public formCollapseAction(action: "collapse" | "uncollapse") {

        // Notify itinerary to compact/expand based on action from form
        if (action === "uncollapse")
            this.itineraryForceAction.next("close");
        else
            this.itineraryForceAction.next("open");
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
            if (!this.isTouchDevice) {
                // Initialize position of the SVG on the cursor
                const cursor = this.getCursorImageElement();
                cursor.style.left = (event.clientX - 12) + "px";
                cursor.style.top = (event.clientY - 30) + "px";
            }
            return;
        }

        // Get the element which the click occured on
        const clickedElement = event.target as HTMLElement;
        if (clickedElement.id !== "map")
            this.resetCursor();
    }

    // Function called when a number input is blurred
    public setDefaultIfEmpty(input: 'walkDistance' | 'fuelConsumption' | 'maxTransfers' | 'walkSpeed' | 'fuelPrice'): void {

        // Check if the blurred input has an invalid value, if so, set to default
        switch (input) {
            case 'walkDistance':
                if (this.selectedWalkDistanceKm === null)
                    this.selectedWalkDistanceKm = MAX_WALK_DISTANCE_DEFAULT;
                break;
            case 'fuelConsumption':
                if (!this.plannerConfig) {
                    this.selectedFuelConsumption = 0;
                    return;
                }
                if (this.selectedFuelConsumption === null)
                    this.selectedFuelConsumption = this.plannerConfig.avg_fuel_consumption_default;
                break;
            case 'maxTransfers':
                if (this.selectedMaxNumberOfTransfers === null)
                    this.selectedMaxNumberOfTransfers = MAX_TRANSFERS_DEFAULT;
                break;
            case 'walkSpeed':
                if (this.selectedWalkingSpeedKmh === null)
                    this.selectedWalkingSpeedKmh = AVG_WALK_SPEED_DEFAULT;
                break;
            case 'fuelPrice':
                if (!this.plannerConfig) {
                    this.selectedFuelPrice = 0;
                    return;
                }
                if (this.selectedFuelPrice === null)
                    this.selectedFuelPrice = this.plannerConfig.fuel_price_default;
                break;
        }
    } 

    public clearItinerary(): void {

        // Automatically open the form back up when itinerary clears
        this.formForceAction.next("open");

        this.tripOptions = null;
        this.mapService.clearLayer('routes');
        this.mapService.clearLayer('returnTrip');
        this.mapService.clearLayer('stops');
    }

    // Function rendering a single leg on the map via map service
    private renderLeg(leg: TripSectionLeg, shouldFocus: boolean, gray: boolean, layerName: string, renderOrigin: boolean, renderDest: boolean) {

        // Get color of leg on the map, a faint gray color for return trip legs
        const bgColor = gray ? "#444444" : this.getLegColor(leg);
        this.mapService.addToLayer({
            layerName,
            type: "route",
            focus: shouldFocus,
            latLng: leg.points,
            color: "provided",
            metadata: {
                color: bgColor,
                dashed: !leg.isTransitLeg,

                // For good contrast the color of the mode image is either dark or white based on the background color
                modeImg: `${leg.mode.toLowerCase()}-${this.isColorLight(bgColor) ? 'dark' : 'white'}.svg`,

                // Flag if this leg is the last leg, used so the full route can be focused onto in the map
                isLastLeg: shouldFocus,
            },
            interactive: true,
            hoover: false,
        });

        // Render stops for a leg that isnt grayed out
        if (!gray)
            this.renderStops(leg, bgColor, renderOrigin, renderDest);
    }   

    // Function rendering a stop onto the leaflet map on the stops layer 
    private renderStop(point: { lat: number, lng: number }, stop_name: string, color: string, zone?: string, departure?: string, arrival?: string) {
        this.mapService.addToLayer({
            layerName: "stops",
            type: "stop",
            focus: false,
            latLng: [point],
            color: "provided",
            metadata: {
                color,
                stop_name,
                departure,
                arrival,
                zone_id: zone,
                is_planner_stop: true, 
            },
            interactive: true,
            hoover: false, 
        });
    }

    // Function rendering stops on the leaflet map
    private renderStops(leg: TripSectionLeg, bgColor: string, renderOrigin: boolean, renderDest: boolean) {

        // Invert color for dark mode if its black, just like to route
        if (bgColor === "#000000")
            bgColor = "#FFFFFF";

        // Render leg origin point
        if (renderOrigin) {
            this.renderStop(
                leg.points[0], 
                leg.from.placeName ?? this.translate.instant("planner.itinerary.legOrigin"),
                bgColor, 
                undefined,
                new Date(leg.from.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            )
        }

        // Render leg destination point
        if (renderDest) {
            this.renderStop(
                leg.points[leg.points.length - 1], 
                leg.to.placeName ?? this.translate.instant("planner.itinerary.legDestination"),
                bgColor, 
                undefined,
                undefined,
                new Date(leg.to.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            )
        }

        // Render stops on public transport trips
        const stops = leg.stops;
        if (!stops)
            return;
        stops.forEach((stop, idx) => {
            const firstStop = idx === 0;
            const lastStop = idx === stops.length - 1;
            this.renderStop(
                { lat: stop.lat, lng: stop.lng }, 
                stop.name,
                bgColor, 
                stop.zone,
                firstStop ? new Date(leg.from.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined,
                lastStop ? new Date(leg.to.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined
            )
        });
    }

    // Function rendering a single trip on the leaflet map using polylines
    public async renderTrip(index: number): Promise<void> {

        if (this.tripOptions === null)
            return;

        const trip = this.tripOptions[index];

        // Reset routes and stops layers before rendering
        this.mapService.clearLayer('routes');
        this.mapService.clearLayer('stops');
        this.mapService.addNewLayer({ name: 'routes', palette: {}, layer: undefined, paletteItemName: '' });
        this.mapService.addNewLayer({ name: 'stops', palette: {}, layer: undefined, paletteItemName: '' });
    
        // Iterate through each leg and call function to render it
        const legs = trip.sections.flatMap(section => section.legs);
        legs.forEach((leg, legIdx) => {

            // Focus when the last leg of the last seciton is being rendered
            const shouldFocus = legIdx === legs.length - 1;

            // Get flags if the origin and destination points of the leg should be explicitly rendered
            const renderOrigin = !leg.isTransitLeg && (legIdx === 0 || (!legs[legIdx - 1].isTransitLeg));
            const renderDest = !leg.isTransitLeg && legIdx === legs.length - 1;
            this.renderLeg(leg, shouldFocus, false, 'routes', renderOrigin, renderDest);
        });
    }

    // Function reacting to itinerary emit when trip option return trip is toggled on map
    public async toggleReturnTrip(params: { idx: number, draw: boolean }): Promise<void> {
        if (this.tripOptions === null)
            return;

        const trip = this.tripOptions[params.idx];

        // Reset the layers
        this.mapService.clearLayer('returnTrip');
        this.mapService.clearLayer('routes');
        this.mapService.clearLayer('stops');
        this.mapService.addNewLayer({ name: 'routes', palette: {}, layer: undefined, paletteItemName: '' });
        this.mapService.addNewLayer({ name: 'stops', palette: {}, layer: undefined, paletteItemName: '' });

        // If the return trip shouldnt be drawn, draw the actual trip in color and stio rendering
        if (!params.draw) {
            const legs = trip.sections.flatMap(section => section.legs);
            legs.forEach((leg, legIdx) => {

                // Get flags if the origin and destination points of the leg should be explicitly rendered
                const renderOrigin = !leg.isTransitLeg && (legIdx === 0 || (!legs[legIdx - 1].isTransitLeg));
                const renderDest = !leg.isTransitLeg && legIdx === legs.length - 1;
                this.renderLeg(leg, false, false, 'routes', renderOrigin, renderDest);
            });
            return;
        }

        // Add layer to draw the return trip onto
        this.mapService.addNewLayer({ name: 'returnTrip', palette: {}, layer: undefined, paletteItemName: '' });

        // Turn on loading screen when fetching shape of the return trip
        this.msgService.turnOnLoadingScreenWithoutPercentage();

        // Only request the return trip shape if it hasnt already been received before
        // note: hasShape flag is set in the backend
        if (!trip.returnTrip.hasShape) {
            trip.returnTrip = await this.apiService.genericPost(
                `${config.apiPrefix}/getReturnTripShape`, trip.returnTrip
            );
        }

        // Turn loading screen back off when the trip shape is received
        this.msgService.turnOffLoadingScreen();

        // Render the actual trip in gray
        const legs = trip.sections.flatMap(section => section.legs);
        legs.forEach((leg, legIdx) => {
            this.renderLeg(leg, false, true, 'routes', false, false);
        });

        // Render legs of the return trip in the map in color
        (trip.returnTrip.section as TripSectionOption).legs.forEach((leg, legIdx) => {

            // Get flags if the origin and destination points of the leg should be explicitly rendered
            const renderOrigin = !leg.isTransitLeg && (legIdx === 0 || (!(trip.returnTrip.section as TripSectionOption).legs[legIdx - 1].isTransitLeg));
            const renderDest = !leg.isTransitLeg && legIdx === (trip.returnTrip.section as TripSectionOption).legs.length - 1;
            this.renderLeg(leg, false, false, 'returnTrip', renderOrigin, renderDest);
        });

        // Set index of shown option on the map in case the rendering is happening on a small device
        if (this.windowWidth < 700)
            this.mobileShownOption = params.idx;
    }

    // Function for settings module switch
    public switchModuleVisibility(value: number): void {
        if (this.moduleFocus !== value)
            this.moduleFocus = value;
        else
            this.moduleFocus = 0;
    }

    // Function called when back to detail is clicked, when a trip option is shown on the map in mobile view
    public mobileHideMap(): void {
        if (!this.tripOptions)
            return;

        const trip = this.tripOptions[this.mobileShownOption!];

        // Redraw only the route of the original trip, not the return
        this.mapService.clearLayer('returnTrip');
        this.mapService.clearLayer('routes');
        this.mapService.clearLayer('stops');
        this.mapService.addNewLayer({ name: 'routes', palette: {}, layer: undefined, paletteItemName: '' });
        this.mapService.addNewLayer({ name: 'stops', palette: {}, layer: undefined, paletteItemName: '' });

        // Flatten the legs and render each one
        const legs = trip.sections.flatMap(section => section.legs);
        legs.forEach((leg, legIdx) => {

            // Get flags if the origin and destination points of the leg should be explicitly rendered
            const renderOrigin = !leg.isTransitLeg && (legIdx === 0 || (!legs[legIdx - 1].isTransitLeg));
            const renderDest = !leg.isTransitLeg && legIdx === legs.length - 1;
            this.renderLeg(leg, false, false, 'routes', renderOrigin, renderDest);
        });

        // No option is shown
        this.mobileShownOption = null;
    }

    // Custom upload handler for file importing
    public async onImportFile(event: FileUploadHandlerEvent): Promise<void> {
        
        // Get plain text inside the uploaded file
        const plainText = await event.files[0].text();

        try {

            // Try to deserialize (may throw exception)
            const object = JSON.parse(plainText);

            // Deserialization successful, validate the structure and semantics
            const tripObject = this.validateTripObject(object);
            if (!tripObject)
                return;

            // Remove existing trip options and clear existing routes
            this.tripOptions = null;
            this.mapService.clearLayer('routes');
            this.mapService.clearLayer('stops');
            this.mapService.clearLayer('returnTrip');

            // Wait for next change detection cycle so changes to tripOptions are propagated to itinerary
            setTimeout(() => {

                // Force collapse the form and expand the itinerary with the trip
                this.formForceAction.next("close");
                this.itineraryForceAction.next("open");

                // Store the trip option
                // Dont want ranking tags when the trip option is imported
                this.tripOptions = [{...tripObject, cheapest: false, fastest: false, best: false}];

                // Collapse import side panel
                this.switchModuleVisibility(3);

                // Render the trip option on the map
                this.renderTrip(0);
            });
        }

        // Invalid JSON syntax
        catch (e) {
            this.msgService.showMessage(
                "error", 
                this.translate.instant('UIMessagesService.toasts.invalidJson.head'), 
                this.translate.instant('UIMessagesService.toasts.invalidJson.body')
            );
        }
    }

    // Function reacting to an emit form the trip form, notifying that the given coordinates should be reverse geocoded
    public async reverseGeocodeRequest(coords: { lat: number, lng: number, position: number }): Promise<void> {
        const placeName = await this.apiService.genericGet(`${config.apiPrefix}/reverseGeocode`, { data: JSON.stringify(coords) }) as { placeName: string | null };
        
        // Set the variable which the trip form will react to changing
        this.geocodedPlaceName = placeName.placeName ? {
            name: placeName.placeName,
            position: coords.position,
        } : null;

        // Set back to null in next change detection cycle
        setTimeout(() => {
            this.geocodedPlaceName = null;
        })
    }

    // Function sorting the array of available trip options based on the passed in field name
    public sortTripOptions(field: TripSortField): void {
        if (!this.tripOptions)
            return;

        // Instead of sorting in place, reassign value, so itenerary gets notified about the change
        switch (field) {
            case "cost": 
                this.tripOptions = [...this.tripOptions].sort((a, b) => a.cost - b.cost);
                break;
            case "duration":
                this.tripOptions = [...this.tripOptions].sort((a, b) => a.duration - b.duration);
                break;
            case "numTransfers":
                this.tripOptions = [...this.tripOptions].sort((a, b) => a.numTransfers - b.numTransfers);
                break;
            case "startDatetime":
                this.tripOptions = [...this.tripOptions].sort((a, b) => a.startDatetime.getTime() - b.startDatetime.getTime());
                break;
        }
    }

    // Function validating the schema and semantics of 'object' as a TripOption with created zod schema
    private validateTripObject(object: unknown): Omit<TripOption, "cheapest" | "best" | "fastest"> | null {

        // Parse with created zod schema
        const parseResult = TripSchema.safeParse(object);

        // Display toast with error when schema doesnt match
        if (!parseResult.success) {
            this.msgService.showMessage(
                "error", 
                this.translate.instant('UIMessagesService.toasts.invalidTripObject.head'), 
                this.translate.instant('UIMessagesService.toasts.invalidTripObject.body')
            );
            return null;
        }

        // Valid TripOption object
        return parseResult.data;
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

    private resetCursor(formUncollapseMobileDelay: number = 0): void {

        // Open the form back up if on a touch device
        // Delay is set when the point is actually correctly selected, so it can be 
        // viewed for a short bit before the form shows back up
        if (this.isTouchDevice) {
            setTimeout(() => {
                this.formForceAction.next("open");
            }, formUncollapseMobileDelay);
        }

        // Otherwise reset the cursor to default
        else {
            // Reset the original cursor values given by .css files
            this.setCursor('');

            // Select svg cursor element based on the previously selected marker
            const cursor = this.getCursorImageElement();

            // Clear the cursor state
            cursor.style.display = 'none';
        }

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

            // Reset the marker cursor after a short delay
            this.resetCursor(400);
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
