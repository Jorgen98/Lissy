import { Component, AfterViewInit } from '@angular/core';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { MapComponent } from '../../src/app/map/map.component';
import { ImportsModule } from '../../src/app/imports';
import { TripFormComponent } from './components/trip-form/trip-form.component';
import { MapService } from '../../src/app/map/map.service';

@Component({
    selector: 'app-planner',
    imports: [ImportsModule, MapComponent, TripFormComponent],
    templateUrl: './planner.component.html',
    styleUrl: './planner.component.css',
})
export class PlannerModule implements AfterViewInit {

    // JSON config file
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;

    // Sidebar module choice
    public moduleFocus: Number = 0;

    constructor(
        private mapService: MapService
    ) {}

    ngAfterViewInit(): void {
        // Show map scale
        this.mapService.configureMapFeatures({ showScale: true });
    }
}
