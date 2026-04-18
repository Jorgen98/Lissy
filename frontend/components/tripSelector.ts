import { Component, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { tripFromDB } from './types';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'trip-selector',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    template: `
        @if (availableTrips.length > 0) {
            <div class="trip-selector-container">
                @for (trip of availableTrips; track $index) {
                    <span class="trip-selector-trip"
                    [class.trip-selector-trip-selected]="actualSelectedTrip?.id == trip.id"
                    (click)="onRouteClick(trip)">
                        {{ '1/1/1970,' + trip.dep_time | date:'HH:mm' }}
                    </span>
                }
            </div>
        } @else {
            <div>{{ 'common.noTrip' | translate }}</div>
        }
    `
})
export class TripSelector {
    trips = input<tripFromDB[]>();
    selectedTrip = input<tripFromDB>();
    tripSelected = output<tripFromDB>();

    availableTrips: tripFromDB[] = [];

    actualSelectedTrip: tripFromDB | undefined;

    constructor() {
        effect(() => {
            this.availableTrips = this.trips() ?? [];

            if (this.availableTrips.length > 0) {
                this.actualSelectedTrip = this.selectedTrip() ?? this.availableTrips[0];
            }
        });
    }

    onRouteClick(tripToSelect: tripFromDB) {
        this.actualSelectedTrip = tripToSelect;
        this.tripSelected.emit(this.actualSelectedTrip);
    }
}
