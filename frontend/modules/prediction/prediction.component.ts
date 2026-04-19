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
import { delayCategoriesService } from '../../src/app/services/delayCategories';
import * as timeStamp from "../../src/app/services/timeStamps";

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
        private msgService: UIMessagesService,
        private delayCategoriesService: delayCategoriesService
    ) {}

    public moduleFocus: Number = 0;
    public isTodayFunctionEnabled: boolean = true;
    public isRouteSelectionEnabled: boolean = true;
    public isDateSelectionEnabled: boolean = true;
    public isSettingsEnabled: boolean = true;
    public showDelayValueLabel: boolean = true;

    public routes: routeFromDB[] = [];
    public selectedRoute: routeFromDB | undefined = undefined;
    public routeTrips: shapeWithTripsFromDB[] = [];
    public selectedTripGroup: shapeWithTripsFromDB | undefined = undefined;
    public selectedTrip: tripFromDB | undefined = undefined;
    private mapData: {coords: number[][][], stops: any[]} | undefined = undefined;
    private actualPredictionValues: number[] = [];
    public selectedDate: { idx: number, date: Date } = { idx: (new Date()).getDay(), date: new Date() };

    public enableZonesOnMap: boolean = true;
    public enableRouteColor: boolean = true;

    // Help function for api requests heading
    private async apiGet(url: string, params?: {[name: string]: string}) {
        return await this.apiService.genericGet(`${config.apiPrefix}/${url}`, params);
    }

    // On component creation
    public async ngOnInit() {
        await this.getDayRoutes();
    }

    // On component destroy
    public ngOnDestroy() {
        this.mapService.removeLayer('route');
        this.mapService.removeLayer('stops');
    }

    // Function for trip selection
    public switchRouteSelectModuleVisibility() {
        if (this.moduleFocus !== 1) {
            this.moduleFocus = 1;
        } else {
            this.moduleFocus = 0;
        }
    }

    // Function for day of week selection
    public switchCalendarSelectModuleVisibility() {
        if (this.moduleFocus !== 2) {
            this.moduleFocus = 2;
        } else {
            this.moduleFocus = 0;
        }
    }

    // Function for settings module switch
    public switchSettingsModuleVisibility() {
        if (this.moduleFocus !== 3) {
            this.moduleFocus = 3;
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

    // Load routes for selected day
    public async getDayRoutes() {
        this.msgService.turnOnLoadingScreenWithoutPercentage();
        this.selectedTripGroup = undefined;
        this.routeTrips = [];
        this.routes = await this.apiGet('getRoutes', { date: timeStamp.getTimeStamp(this.selectedDate.date.getTime()) });
        if (this.routes.length > 0) {
            const collator = new Intl.Collator(undefined, {
                numeric: true,
                sensitivity: "base"
            });

            this.routes = this.routes.sort((a, b) => collator.compare(a.route_short_name, b.route_short_name));
            await this.routeSelected(this.routes[0]);
        } else {
            this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDataForSelection.head', 'UIMessagesService.toasts.noAvailableDataForSelection.body');
        }

        this.msgService.turnOffLoadingScreen();
    }

    // Put actual route shape on map
    public async routeSelected(route: routeFromDB) {
        this.msgService.turnOnLoadingScreenWithoutPercentage();
        this.selectedRoute = route;
        this.routeTrips = await this.apiGet("getTrips", {date: timeStamp.getTimeStamp(this.selectedDate.date.getTime()), route_id: route.id.toString()});
        if (this.routeTrips.length > 0) {
            this.selectedTripGroup = this.routeTrips[0];
            if (this.selectedTripGroup.trips.length > 0) {
                await this.tripSelected(this.selectedTripGroup.trips[0]);   
            }
        } else {
            this.selectedTripGroup = undefined;
            this.mapService.clearLayer('route');
            this.mapService.clearLayer('stops');
            this.delayCategoriesService.removeDelayCategoriesFromMap();
            this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDataForSelection.head', 'UIMessagesService.toasts.noAvailableDataForSelection.body');
        }

        this.msgService.turnOffLoadingScreen();
    }

    public async tripGroupSelected() {
        if (this.selectedTripGroup && this.selectedTripGroup.trips.length > 0) {
            this.tripSelected(this.selectedTripGroup.trips[0]);
        }
    }

    public async tripSelected(trip: tripFromDB) {
        if (this.selectedTripGroup === undefined) {
            return;
        }

        this.msgService.turnOnLoadingScreenWithoutPercentage();
        this.selectedTrip = trip;
        const predictionResult = await this.apiGet('getPrediction', {
            dep_time: this.selectedTrip.dep_time,
            line: this.selectedRoute?.route_short_name ?? '',
            route: this.selectedTripGroup?.stops ?? '',
            date: timeStamp.getTimeStamp(this.selectedDate.date.getTime())
        });

        console.log(predictionResult);

        if (predictionResult.predictionResponse?.shape === undefined || predictionResult.predictionResponse?.shape === undefined ||
            predictionResult.predictionResponse?.prediction === undefined || predictionResult.predictionResponse?.prediction.length < 1
        ) {
            this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailablePrediction.head', 'UIMessagesService.toasts.noAvailablePrediction.body');
            this.mapService.clearLayer('route');
            this.mapService.clearLayer('stops');
            this.delayCategoriesService.removeDelayCategoriesFromMap();
            this.msgService.turnOffLoadingScreen();
            return;   
        }

        this.mapData = await this.apiGet('getShape', {shape_id: this.selectedTripGroup.shape_id.toString()});

        this.actualPredictionValues = Object.values(predictionResult.predictionResponse?.prediction);
        this.delayCategoriesService.resetDelayCategories();
        this.renderData(true);
    }

        // Put actual route shape on map
    public async renderData(focus = false) {
        this.msgService.turnOnLoadingScreenWithoutPercentage();
        this.mapService.clearLayer('route');
        this.mapService.addNewLayer({name: 'route', palette: {}, layer: undefined, paletteItemName: 'map.zon'});

        this.mapService.clearLayer('stops');
        this.mapService.addNewLayer({name: 'stops', palette: {}, layer: undefined, paletteItemName: 'map.zone'});

        this.delayCategoriesService.removeDelayCategoriesFromMap();

        if (!this.selectedTripGroup?.shape_id || this.mapData === undefined) {
            this.msgService.turnOffLoadingScreen();
            this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDataForSelection.head', 'UIMessagesService.toasts.noAvailableDataForSelection.body');
            return;
        }

        if (!this.mapData.stops || !this.mapData.coords) {
            this.msgService.turnOffLoadingScreen();
            return;
        }

        // Set delay categories according to actual predicated values
        const sorted = [...this.actualPredictionValues].sort((a, b) => a - b);

        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q2 = sorted[Math.floor(sorted.length * 0.50)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];

        this.delayCategoriesService.setDelayCategory(0, {
            minValue: -Infinity,
            maxValue: q1
        })
        this.delayCategoriesService.setDelayCategory(1, {
            minValue: q1,
            maxValue: q2
        })
        this.delayCategoriesService.setDelayCategory(2, {
            minValue: q2,
            maxValue: q3
        })
        this.delayCategoriesService.setDelayCategory(3, {
            minValue: q3,
            maxValue: Infinity
        })

        // Put stops on stops layer
        for (const [idx, stop] of this.mapData.stops.entries()) {
            let mapStop: mapObject = {
                layerName: 'stops',
                type: 'stop',
                focus: false,
                latLng: [{lat: stop.coords[0], lng: stop.coords[1]}],
                color: this.enableZonesOnMap ? 'palette' : 'base',
                metadata: {
                    stop_name: stop.stop_name,
                    wheelchair_boarding: stop.wheelchair_boarding,
                    zone_id: stop.zone_id,
                    order: idx + 1
                },
                interactive: true,
                hoover: false
            }

            this.mapService.addToLayer(mapStop);
        }

        // Put route shape on the shapes layer
        for (const [idx, routePart] of this.mapData.coords.entries()) {
            const routePartDelay = this.actualPredictionValues[idx];
            const routePartName = `${this.mapData.stops[idx].stop_name} -> ${this.mapData.stops[idx + 1].stop_name}`;
            let mapRoutePart: mapObject = {
                layerName: 'route',
                type: 'route',
                focus: false,
                latLng: routePart.map((coord: any) => {return {lat: coord[0], lng: coord[1]}}),
                color: this.enableRouteColor ? 'provided' : 'base',
                metadata: {
                    route_name: routePartName,
                    color: this.delayCategoriesService.getDelayCategoryByValue(routePartDelay).color,
                    delay_value: this.showDelayValueLabel ? routePartDelay : undefined,
                    label: 'prediction.mapLabel'
                },
                interactive: routePartDelay === undefined || !this.showDelayValueLabel ? false : true,
                hoover: false
            }

            this.mapService.addToLayer(mapRoutePart);
        }

        if (focus) {
            this.mapService.fitToLayer('stops');
        }
        this.delayCategoriesService.putDelayCategoriesOnMap();
        this.msgService.turnOffLoadingScreen();
    }

    public async onDaySelected(idx: number) {
        this.selectedDate.idx = idx;

        const today = new Date();
        const currentDay = today.getDay();
        let diff = idx - currentDay;
        // Always move to the future
        if (diff <= 0) {
            diff += 7;
        }
        this.selectedDate.date.setDate(today.getDate() + diff);

        await this.getDayRoutes();
    }

    public closeRouteModule() {
        this.moduleFocus = 0;
    }
}