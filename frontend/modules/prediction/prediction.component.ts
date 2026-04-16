import { Component, OnDestroy, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';
import { MapComponent } from '../../src/app/map/map.component';
import { mapObject, MapService } from '../../src/app/map/map.service';
import { UIMessagesService } from '../../src/app/services/messages';
import { routeFromDB, shapeWithTripsFromDB, tripFromDB } from '../../components/types';

@Component({
    selector: 'prediction',
    imports: [ImportsModule, MapComponent],
    templateUrl: './prediction.component.html',
    styleUrl: './prediction.component.css'
})

export class PredictionModule implements OnInit, OnDestroy {
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;
    constructor(
        private apiService: APIService,
        public translate: TranslateService,
        public mapService: MapService,
        private msgService: UIMessagesService
    ) {}

    public moduleFocus: Number = 0;
    public isTodayFunctionEnabled: boolean = true;
    public isRouteSelectionEnabled: boolean = true;
    public isDateSelectionEnabled: boolean = true;
    public isSettingsEnabled: boolean = true;

    public selectedDate: Date | null = null;
    public hooverDate: Date | null = null;
    public startDate: Date = new Date();
    public disabledDates: Date[] = [];
    public endDate: Date = new Date();

    public routes: routeFromDB[] = [];
    public selectedRoute: routeFromDB | undefined = undefined;
    public routeTrips: shapeWithTripsFromDB[] = [];
    public selectedTripGroup: shapeWithTripsFromDB | undefined;
    private mapData: {coords: number[][][], stops: any[]} | undefined = undefined;

    public enableZonesOnMap: boolean = true;
    public enableRouteColor: boolean = true;

    // Help function for api requests heading
    private async apiGet(url: string, params?: {[name: string]: string}) {
        return await this.apiService.genericGet(`${config.apiPrefix}/${url}`, params);
    }

    // On component creation
    public async ngOnInit() {
        this.msgService.turnOnLoadingScreenWithoutPercentage();
        this.routes = await this.apiGet('getRoutes');
        if (this.routes.length > 0) {
            this.routeSelected(this.routes[0]);
        }

        this.msgService.turnOffLoadingScreen();
    }

    // On component destroy
    public ngOnDestroy() {
        this.mapService.removeLayer('route');
        this.mapService.removeLayer('stops');
    }

    // Function for calendar module switch
    public switchRouteSelectModuleVisibility() {
        if (this.moduleFocus !== 1) {
            this.moduleFocus = 1;
        } else {
            this.moduleFocus = 0;
        }
    }

    // Function for settings module switch
    public switchSettingsModuleVisibility() {
        if (this.moduleFocus !== 2) {
            this.moduleFocus = 2;
        } else {
            this.moduleFocus = 0;
        }
    }

    // Function for mobile submenu switch
    public switchMobileSubMenuVisibility() {
        if (this.moduleFocus !== -1) {
            this.moduleFocus = -1;
        } else {
            this.moduleFocus = 0;
        }
    }

    // Function for mobile setting switch
    public switchMobileOptionsVisibility() {
        if (this.moduleFocus !== -2) {
            this.moduleFocus = -2;
        } else {
            this.moduleFocus = 0;
        }
    }

    public setToday() {
        this.hooverDate = new Date();
    }

    // Put actual route shape on map
    public async routeSelected(route: routeFromDB) {
        this.msgService.turnOnLoadingScreenWithoutPercentage();
        this.selectedRoute = route;
        this.routeTrips = await this.apiGet("getTrips", {route_id: route.id.toString()});
        if (this.routeTrips.length > 0) {
            this.selectedTripGroup = this.routeTrips[0];
            if (this.selectedTripGroup.trips.length > 0) {
                this.tripSelected(this.selectedTripGroup.trips[0]);   
            }
        }

        this.msgService.turnOffLoadingScreen();
    }

    public async tripGroupSelected() {
        if (this.selectedTripGroup && this.selectedTripGroup.trips.length > 0) {
            this.tripSelected(this.selectedTripGroup.trips[0]);
        }
    }

    public async tripSelected(selectedTrip: tripFromDB) {
        this.msgService.turnOnLoadingScreenWithoutPercentage();
        console.log(await this.apiGet('getPrediction', {
            dep_time: selectedTrip.dep_time,
            line: this.selectedRoute?.route_short_name ?? '',
            route: this.selectedTripGroup?.stops ?? ''
        }))
        this.msgService.turnOffLoadingScreen();
    }

    public closeRouteModule() {
        this.moduleFocus = 0;
    }
}