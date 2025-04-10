import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';
import { MapComponent } from '../../src/app/map/map.component';
import { mapObject, MapService } from '../../src/app/map/map.service';
import { UIMessagesService } from '../../src/app/services/messages';
import * as timeStamp from "../../src/app/services/timeStamps";
import { delayCategoriesService, delayCategory } from '../../src/app/services/delayCategories';
import { faRoute } from '@fortawesome/free-solid-svg-icons';

interface route {
    route_short_name: string,
    id: number
}

interface trip {
    id: number,
    dep_time: string,
    dep_time_lab: string
}

interface tripGroup {
    shape_id: number,
    stops: string,
    trips: trip[]
}

@Component({
    selector: 'delay-trips',
    imports: [ImportsModule, MapComponent],
    templateUrl: './delay-trips.component.html',
    styleUrl: './delay-trips.component.css'
})

export class DelayTripsModule implements OnInit {
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;
    constructor (
        private apiService: APIService,
        public translate: TranslateService,
        public mapService: MapService,
        private msgService: UIMessagesService,
        private delayCategoriesService: delayCategoriesService
    ) {
        translate.onLangChange.subscribe(async () => {
            await this.changeRoute();
            this.setUpAggMethods();
        })
    }

    public moduleFocus: Number = 0;
    public isTodayFunctionEnabled: boolean = true;
    public isRouteSelectionEnabled: boolean = true;
    public isDateSelectionEnabled: boolean = true;
    public isSettingsEnabled: boolean = true;

    public selectedDates: Date[] | null = null;
    public hooverDates: Date[] | null = null;
    public startDate: Date = new Date();
    public disabledDates: Date[] = [];
    public endDate: Date = new Date();

    public queryDates: string[][] = [];

    public routes: route[] = [];
    public selectedRoute: route | undefined = undefined;
    public tripGroups: tripGroup[] = [];
    public selectedTripGroup: tripGroup | undefined = undefined;
    public selectedTrip: trip | undefined = undefined;
    public selectedTripGroupShape: {stops: any[], coords: number[][][]} | undefined = undefined;
    public selectedTripData: {[date_key: string]: {[path_group_index: number]: {[path_index: number]: number}}} = {};

    public aggregationMethods: {label: string, operation: 'avg' | 'sum' | 'max' | 'min' }[] = [];
    public selectedAggMethod: {label: string, operation: 'avg' | 'sum' | 'max' | 'min'} | undefined = undefined;

    public showDelayValueLabel: boolean = false;
    public showSimplifiedDelays: boolean = true;

    public delayCategories: delayCategory[] = [];

    public faIconRoute = faRoute;

    // Help function for api requests heading
    private async apiGet(url: string, params?: {[name: string]: string}) {
        return await this.apiService.genericGet(`${config.apiPrefix}/${url}`, params);
    }

    // On component creation
    public async ngOnInit() {
        if(!await this.apiService.isConnected()) {
            this.isRouteSelectionEnabled = false;
            this.isDateSelectionEnabled = false;
            this.isSettingsEnabled = false;
            this.msgService.showMessage('error', 'UIMessagesService.toasts.dbConnectError.head', 'UIMessagesService.toasts.dbConnectError.body');
            return;
        }

        this.setUpAggMethods();

        this.msgService.turnOnLoadingScreenWithoutPercentage();
        let apiDates = await this.apiGet('availableDates');

        if (apiDates.start === undefined || apiDates.end === undefined) {
            this.startDate = new Date();
            this.disabledDates.push(new Date());
            this.endDate = new Date();
            this.isDateSelectionEnabled = false;
            this.isSettingsEnabled = false;
            this.isRouteSelectionEnabled = false;
            this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDates.head', 'UIMessagesService.toasts.noAvailableDates.body');
            this.msgService.turnOffLoadingScreen();
            return;
        }

        this.startDate = timeStamp.getDate(apiDates.start);
        for (const date of apiDates.disabled) {
            this.disabledDates.push(timeStamp.getDate(date));
        }
        this.endDate = timeStamp.getDate(apiDates.end);

        this.selectedDates = [timeStamp.getDate(apiDates.end)];
        this.hooverDates = [timeStamp.getDate(apiDates.end)];
        this.isTodayFunctionEnabled = false;

        // Get dates, when stats are available
        let today = timeStamp.getTimeStamp(new Date().getTime());
        if (!this.disabledDates.find((date) => {return timeStamp.getTimeStamp(date.getTime()) === today}) &&
            (timeStamp.compareTimeStamps(apiDates.start, today) === -1) && (timeStamp.compareTimeStamps(apiDates.end, today) === 1)) {
            this.isTodayFunctionEnabled = true;
        }

        // Get stats for latest date
        await this.downloadRoutesData();
    }

    private setUpAggMethods() {
        this.aggregationMethods = [
            {label: this.translate.instant('delay.avg'), operation: 'avg'},
            {label: this.translate.instant('delay.sum'), operation: 'sum'},
            {label: this.translate.instant('delay.max'), operation: 'max'},
            {label: this.translate.instant('delay.min'), operation: 'min'}
        ];

        this.selectedAggMethod = this.aggregationMethods[0];
    }

    // Function for calendar module switch
    public switchCalendarModuleVisibility() {
        if (this.moduleFocus !== 1 && this.selectedDates !== null) {
            this.hooverDates = [];
            for (const date of this.selectedDates) {
                this.hooverDates.push(new Date(date));
            }
            this.moduleFocus = 1;
        } else {
            this.moduleFocus = 0;
        }
    }

    // Function for calendar module switch
    public switchRouteSelectModuleVisibility() {
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
            this.delayCategories = this.delayCategoriesService.getDelayCategories();
        } else {
            this.moduleFocus = 0;
        }
    }

    public setToday() {
        this.hooverDates = [new Date()];
    }

    public async downloadRoutesData() {
        if (this.hooverDates === null) {
            return;
        }

        this.moduleFocus = 0;
        this.msgService.turnOnLoadingScreen();
        this.queryDates = [];

        this.hooverDates.sort((a, b) => { return a.valueOf() > b.valueOf() ? 1 : -1});

        this.selectedDates = [];
        for (const date of this.hooverDates) {
            this.selectedDates.push(new Date(date));
        }

        let UTCHooverDates: string[] = [];
        for (const date of this.hooverDates) {
            UTCHooverDates.push(timeStamp.getTimeStamp(date.getTime() - (date.getTimezoneOffset() * 60 * 1000)))
        }

        // Get data for selected dates
        let actualDate = UTCHooverDates[0];
        let isGoing = true;
        this.queryDates.push([actualDate]);
        while (timeStamp.compareTimeStamps(actualDate, timeStamp.addOneDayToTimeStamp(UTCHooverDates[UTCHooverDates.length - 1])) !== 1) {
            if (isGoing && UTCHooverDates.findIndex((date) => {return actualDate === date}) === -1) {
                this.queryDates[this.queryDates.length - 1].push(timeStamp.removeOneDayFromTimeStamp(actualDate));
                isGoing = false;
            } else if (!isGoing && UTCHooverDates.findIndex((date) => {return actualDate === date}) !== -1) {
                this.queryDates.push([actualDate]);
                isGoing = true;
            }
            actualDate = timeStamp.addOneDayToTimeStamp(actualDate);
        }
        this.queryDates[this.queryDates.length - 1].push(UTCHooverDates[UTCHooverDates.length - 1]);

        // API call for data
        this.routes = await this.apiGet('getAvailableRoutes', {dates: JSON.stringify(this.queryDates)});
        if (this.routes.length > 0) {
            this.isRouteSelectionEnabled = true;
            this.selectedRoute = this.routes[0];
            await this.changeRoute();
        } else {
            this.isRouteSelectionEnabled = false;
            this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDataForSelection.head', 'UIMessagesService.toasts.noAvailableDataForSelection.body');
        }
        this.msgService.turnOffLoadingScreen();
    }

    public async changeRoute() {
        if (this.selectedRoute) {
            this.msgService.turnOnLoadingScreenWithoutPercentage();
            this.tripGroups = await this.apiGet('getAvailableTrips', {dates: JSON.stringify(this.queryDates), route_id: this.selectedRoute.id.toString()});
            if (this.tripGroups.length > 0) {
                for (const group of this.tripGroups) {
                    for (let trip of group.trips) {
                        if (this.translate.currentLang === 'cz') {
                            trip.dep_time_lab = trip.dep_time.slice(0, 5);
                        } else {
                            let hours = parseInt(trip.dep_time.slice(0, 2));
                            if (hours > 12) {
                                trip.dep_time_lab = `${hours - 12}${trip.dep_time.slice(2, 5)} PM`;
                            } else {
                                trip.dep_time_lab = `${trip.dep_time.slice(0, 5)} AM`;
                            }
                        }
                    }

                    if (group.trips.length > 1) {
                        group.trips.push({
                            id: -1,
                            dep_time: "",
                            dep_time_lab: this.translate.instant("delay.allTrips")
                        })
                    }
                }

                this.selectedTripGroup = this.tripGroups[0];
                await this.changeTripGroup();
            }
            this.msgService.turnOffLoadingScreen();
        }
    }

    public async changeTripGroup() {
        if (this.selectedTripGroup && this.selectedTripGroup.trips.length > 0) {
            this.msgService.turnOnLoadingScreenWithoutPercentage();
            this.selectedTripGroupShape = await this.apiGet('getShape', {shape_id: this.selectedTripGroup.shape_id.toString()});

            this.selectedTrip = this.selectedTripGroup.trips[0];
            await this.changeTrip();
        } else {
            this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDataForSelection.head', 'UIMessagesService.toasts.noAvailableDataForSelection.body');
        }
        this.msgService.turnOffLoadingScreen();
    }

    public async changeTrip() {
        if (this.selectedTrip) {
            this.msgService.turnOnLoadingScreenWithoutPercentage();

            if (this.selectedTrip.id !== -1) {
                this.selectedTripData = await this.apiGet('getTripData', {dates: JSON.stringify(this.queryDates), trip_id: this.selectedTrip.id.toString()});
            } else if (this.selectedTripGroup) {
                this.selectedTripData = {};
                for (const trip of this.selectedTripGroup?.trips) {
                    if (trip.id === -1) {
                        continue;
                    }
                    let inputData = await this.apiGet('getTripData', {dates: JSON.stringify(this.queryDates), trip_id: trip.id.toString()});

                    for (const record in inputData) {
                        this.selectedTripData[`${record}_${trip.id}`] = inputData[record];
                    }
                }
            }

            if (Object.keys(this.selectedTripData).length > 0) {
                this.renderData(true);
            } else {
                this.mapService.removeLayer('route');
                this.mapService.removeLayer('stops');
                this.delayCategoriesService.removeDelayCategoriesFromMap();
                this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDataForSelection.head', 'UIMessagesService.toasts.noAvailableDataForSelection.body');
            }
            this.msgService.turnOffLoadingScreen();
        }
    }

    public renderData(focus: boolean) {
        this.mapService.removeLayer('route');
        this.mapService.addNewLayer({name: 'route', palette: {}, layer: undefined, paletteItemName: 'map.zone'});

        this.mapService.removeLayer('stops');
        this.mapService.addNewLayer({name: 'stops', palette: {}, layer: undefined, paletteItemName: 'map.zone'});

        if (!this.selectedTripGroupShape || !this.selectedTripGroupShape.stops || !this.selectedTripGroupShape.coords) {
            return;
        }

        if (Object.keys(this.selectedTripData).length < 1) {
            return;
        }

        this.delayCategoriesService.putDelayCategoriesOnMap();

        for (const stop of this.selectedTripGroupShape.stops) {
            let mapStop: mapObject = {
                layerName: 'stops',
                type: 'stop',
                focus: false,
                latLng: [{lat: stop.coords[0], lng: stop.coords[1]}],
                color: 'provided',
                metadata: {
                    stop_name: stop.stop_name
                },
                interactive: true
            }

            this.mapService.addToLayer(mapStop);
        }

        for (const [routePartIdx, routePart] of this.selectedTripGroupShape.coords.entries()) {
            let routePartDelay = undefined;
            if (this.showSimplifiedDelays) {
                let delays = [];
                for (const key of Object.keys(this.selectedTripData)) {
                    if (this.selectedTripData[key][routePartIdx]) {
                        delays.push(this.selectedTripData[key][routePartIdx][routePart.length - 2]);
                    }
                }
                routePartDelay = this.getActualDelayValue(delays);
            }
            for (let idx = 0; idx < (routePart.length - 1); idx++) {
                let delay = undefined;
                if (this.showSimplifiedDelays) {
                    delay = routePartDelay;
                } else {
                    let delays = [];
                    for (const key of Object.keys(this.selectedTripData)) {
                        if (this.selectedTripData[key][routePartIdx]) {
                            delays.push(this.selectedTripData[key][routePartIdx][idx]);
                        }
                    }
                    delay = this.getActualDelayValue(delays);
                }

                const delayCategory = this.delayCategoriesService.getDelayCategoryByValue(delay);

                let mapRoutePart: mapObject = {
                    layerName: 'route',
                    type: 'route',
                    focus: false,
                    latLng: [{lat: routePart[idx][0], lng: routePart[idx][1]}, {lat: routePart[idx + 1][0], lng: routePart[idx + 1][1]}],
                    color: 'provided',
                    metadata: {
                        color: delayCategory.color,
                        delay_value: this.showDelayValueLabel ? delay : undefined,
                        agg_method: this.selectedAggMethod?.operation
                    },
                    interactive: true
                }

                this.mapService.addToLayer(mapRoutePart);
            }
        }

        if (focus) {
            this.mapService.fitToLayer('stops');
        }
    }

    private getActualDelayValue(delays: number[]) {
        let delay = undefined;
        let numOfDateDelays = 0;
        for (const value of delays) {
            if (value !== undefined) {
                if (delay === undefined) {
                    delay = 0;
                }
                switch (this.selectedAggMethod?.operation) {
                    case 'avg': case 'sum': delay += value; numOfDateDelays += 1; break;
                    case 'max': delay < value ? delay = value : null; break;
                    case 'min': delay > value ? delay = value : null; break;
                }
            }
        }
        if (this.selectedAggMethod?.operation === 'avg' && delay !== undefined) {
            delay = Math.floor((delay * 1.0) / (numOfDateDelays * 1.0) * 100.0) / 100.0;
        }

        return delay;
    }

    public onDelayCategoryChange(idx: number) {
        this.delayCategoriesService.setDelayCategory(idx, this.delayCategories[idx]);
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }

    public removeDelayCategory(idx: number) {
        this.delayCategoriesService.removeDelayCategory(idx);
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }

    public addDelayCategory() {
        this.delayCategoriesService.addNewDelayCategory();
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }

    public resetDelayCategories() {
        this.delayCategoriesService.resetDelayCategories();
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }

    public closeRouteModule() {
        this.moduleFocus = 0;
    }
}