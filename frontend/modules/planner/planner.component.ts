import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { MapComponent } from '../../src/app/map/map.component';
import { ImportsModule } from '../../src/app/imports';
import { TripFormComponent } from './components/trip-form/trip-form.component';
import { MapService } from '../../src/app/map/map.service';
import { APIService } from '../../src/app/services/api';
import { UIMessagesService } from '../../src/app/services/messages';
import { Stop } from './types/Stop';
import { 
    Component, 
    AfterViewInit, 
    ViewChild, 
    ElementRef, 
    HostListener,
    OnInit
} from '@angular/core';

@Component({
    selector: 'app-planner',
    imports: [ImportsModule, MapComponent, TripFormComponent],
    templateUrl: './planner.component.html',
    styleUrl: './planner.component.css',
})
export class PlannerModule implements AfterViewInit, OnInit {

    // JSON config file
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;

    // Sidebar module choice
    public moduleFocus: Number = 0;

    // References to SVG images used as cursors when a new stop is being selected in the map
    @ViewChild('startCursor') startCursorRef!: ElementRef<SVGElement>;
    @ViewChild('midpointCursor') midpointCursorRef!: ElementRef<SVGElement>;
    @ViewChild('endCursor') endCursorRef!: ElementRef<SVGElement>;

    // Whether the cursor is currently a map marker
    private markerCursor: string | null = null;

    // Flag for synchronization between onClick() and markerClick() methods
    // markerClick is used for setting the cursor, onClick is used for clearing it if a click happens oustide the leaflet map
    // onClick needs to not clear the cursor right after markerClick sets it
    private clickSyncFlag: boolean = false;

    // List of all stops in the transport system with coordinates and names
    public allStops: Stop[] = []; 

    constructor(
        private mapService: MapService,
        private apiService: APIService,
        private msgService: UIMessagesService
    ) {}

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
        const stops = await this.apiService.genericGet(`${config.apiPrefix}/allStops`);
        if (!stops) {
            this.msgService.showMessage('error', 'UIMessagesService.toasts.stopsUnavailable.head', 'UIMessagesService.toasts.stopsUnavailable.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        this.allStops = stops.stops;

        // Turn off loading screen after initialization is done
        this.msgService.turnOffLoadingScreen();
    }

    // Function called when a marker in the form is clicked
    public markerClick(markerType: string): void {

        // Do nothing if the cursor is already a marker
        if (this.markerCursor)
            return;

        // Set the flag so onClick method doesnt clear the new cursor image
        this.clickSyncFlag = true;

        // Store the state of the cursor
        this.markerCursor = markerType;

        // Hide classic cursor on the form and leaflet map elements
        const map = document.querySelector('#map') as HTMLElement;
        const form = document.querySelector('.form') as HTMLElement;
        map.style.cursor = 'none';
        form.style.cursor = 'none';
        form.querySelectorAll('*').forEach(element => {
            (element as HTMLElement).style.cursor = 'none';
        });

        // Select new cursor image based on which marker was clicked in the form
        const cursor = this.getCursorImageElement();

        // Make cursor visible
        cursor.style.zIndex = '500';
        cursor.style.display = 'inline';
    }

    // Function called when the mouse is moved (mousemove event happens)
    @HostListener('document:mousemove', ['$event'])
    public onMouseMove(event: MouseEvent): void {

        // If the cursor is not currently a marker, do nothing
        if (!this.markerCursor)
            return;

        // Update position of the SVG on the cursor
        const cursor = this.getCursorImageElement();
        cursor.style.left = event.clientX + 'px';
        cursor.style.top = event.clientY + 'px';
    }

    // Function called when any key is pressed (keyboard event happens)
    @HostListener('document:keydown', ['$event'])
    public onKeyDown(event: KeyboardEvent): void {

        // If the cursor is not currently a marker, do nothing
        if (!this.markerCursor)
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
        if (!this.markerCursor)
            return;

        // If the sync flag is currently on, the cursor was just changed to a marker in markerClicked()
        if (this.clickSyncFlag) {
            this.clickSyncFlag = false;

            // Initialize position of the SVG on the cursor
            const cursor = this.getCursorImageElement();
            cursor.style.left = event.clientX + "px";
            cursor.style.top = event.clientY + "px";
            return;
        }

        // Get the element which the click occured on
        const clickedElement = event.target as HTMLElement;
        if (clickedElement.id === "map"){
            // TODO Place point on map    
        }
        else
            this.resetCursor();
    }

    private resetCursor(): void {

        // Reset the original cursor values given by .css files
        const map = document.querySelector('#map') as HTMLElement;
        const form = document.querySelector('.form') as HTMLElement;
        map.style.cursor = '';
        form.style.cursor = '';
        form.querySelectorAll('*').forEach(el => {
            (el as HTMLElement).style.cursor = '';
        });

        // Select svg cursor element based on the previously selected marker
        const cursor = this.getCursorImageElement();

        // Clear the cursor state
        cursor.style.display = 'none';
        this.markerCursor = null;
    }

    // Function returning a SVG element that should be used as the new cursor for trip point selection
    private getCursorImageElement(): SVGElement {
        if (this.markerCursor === "start")
            return this.startCursorRef.nativeElement;
        else if (this.markerCursor === "end")
            return this.endCursorRef.nativeElement;
        return this.midpointCursorRef.nativeElement;
    }
}
