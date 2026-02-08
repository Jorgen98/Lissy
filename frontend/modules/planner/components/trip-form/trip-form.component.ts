import { Component, AfterViewInit } from '@angular/core';
import { TransportMode } from '../../types/TransportMode';
import { TranslateService } from '@ngx-translate/core';
import { ImportsModule } from '../../../../src/app/imports';

@Component({
    selector: 'trip-form',
    imports: [ImportsModule],
    templateUrl: './trip-form.component.html',
    styleUrl: './trip-form.component.css',
})
export class TripFormComponent implements AfterViewInit {
    
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

    constructor(
        public translate: TranslateService,
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

    // Function called when a transport mode is toggled as on/off
    public modeToggled(mode: TransportMode): void {
        this.modesSelected[mode] = !this.modesSelected[mode];
    }
}
