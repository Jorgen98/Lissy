import { Component, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { tripFromDB } from './types';

@Component({
    selector: 'trip-selector',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="trip-selector-container">
            @for (trip of availableTrips; track $index) {
                <span class="trip-selector-trip"
                [class.trip-selector-trip-selected]="selectedTrip?.id == trip.id"
                (click)="onRouteClick(trip)">
                    {{ '1/1/1970,' + trip.dep_time | date:'HH:mm' }}
                </span>
            }
        </div>
    `
})
export class TripSelector {
    trips = input<tripFromDB[]>();
    tripSelected = output<tripFromDB>();

    availableTrips: tripFromDB[] = [];

    selectedTrip: tripFromDB | undefined;

    constructor() {
        effect(() => {
            this.availableTrips = this.trips() ?? [];

            if (this.availableTrips.length > 0) {
                this.selectedTrip = this.availableTrips[0];
            }
        });
    }

    onRouteClick(tripToSelect: tripFromDB) {
        this.selectedTrip = tripToSelect;
        this.tripSelected.emit(this.selectedTrip);
    }
}
