import { Component, OnDestroy, OnInit } from '@angular/core';
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
};

interface trip {
    id: number,
    dep_time: string,
    dep_time_lab: string
};

interface tripGroup {
    shape_id: number,
    stops: string,
    trips: trip[]
};

interface graphData {
    labels: string[],
    datasets: any[]
};

@Component({
    selector: 'delay-trips',
    imports: [ImportsModule, MapComponent],
    templateUrl: './delay-trips.component.html',
    styleUrl: './delay-trips.component.css'
})

export class DelayTripsModule implements OnInit, OnDestroy {
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
            this.closeRouteModule();
            if (this.tripGroups.length > 0) {
                let selectedTripIdx = this.selectedTripGroup?.trips.findIndex((item) => { return item.id === this.selectedTrip?.id});
                for (const group of this.tripGroups) {
                    this.setUpTripsDepTimes(group.trips);
                }

                if (selectedTripIdx !== undefined) {
                    this.selectedTrip = this.selectedTripGroup?.trips[selectedTripIdx];
                }
            }
            this.setUpAggMethods();
            this.renderData(false);
        });
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
    public selectedTripData: {[date_key: string]:{[time_key: string]: {[path_group_index: number]: {[path_index: number]: number}}}} = {};

    public aggregationMethods: {label: string, operation: 'avg' | 'sum' | 'max' | 'min' }[] = [];
    public selectedAggMethod: {label: string, operation: 'avg' | 'sum' | 'max' | 'min'} | undefined = undefined;

    public showDelayValueLabel: boolean = false;
    public showSimplifiedDelays: boolean = true;

    public delayCategories: delayCategory[] = [];

    public faIconRoute = faRoute;

    public tripsGraphData: graphData = {labels: [], datasets: []};
    public tripsGraphAggFns: {label: string, operation: 'trip' | 'date'}[] = [];
    public tripsGraphSelAggFn: {label: string, operation: 'trip' | 'date'} | undefined = undefined;

    // Graph options according to type
    public documentStyle = getComputedStyle(document.documentElement);
    public graphTimeOptionsLegend = {
        maintainAspectRatio: false,
        aspectRatio: 1,
        plugins: {
            legend: { labels: { color: this.documentStyle.getPropertyValue('--gray-50')} },
            tooltip: {
                callbacks: {
                    label: function(context: any) {
                        return context.dataset.label;
                    }
                }
            }
        },
        scales: {
            x: {
                ticks: {
                    color: this.documentStyle.getPropertyValue('--gray-50')
                },
                grid: {
                    color: this.documentStyle.getPropertyValue('--gray-500'),
                    drawBorder: false
                }
            },
            y: {
                ticks: {
                    callback: (value: any, index: any, ticks: any) => {
                        return `${value} min.`
                    },
                    stepSize: 0.5
                },
                grid: {
                    color: this.documentStyle.getPropertyValue('--gray-500'),
                    drawBorder: false
                }
            }
        }
    };

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

    // On component destroy
    public ngOnDestroy() {
        this.mapService.removeLayer('route');
        this.mapService.removeLayer('stops');
    }

    // Set up aggregation methods according to user selected language
    private setUpAggMethods() {
        const selectedFnIdx = this.aggregationMethods.findIndex((item) => { return item.operation === this.selectedAggMethod?.operation});

        this.aggregationMethods = [
            {label: this.translate.instant('delay.avg'), operation: 'avg'},
            {label: this.translate.instant('delay.sum'), operation: 'sum'},
            {label: this.translate.instant('delay.max'), operation: 'max'},
            {label: this.translate.instant('delay.min'), operation: 'min'}
        ];

        // If some function was selected then it is used after translation
        if (selectedFnIdx === -1) {
            this.selectedAggMethod = this.aggregationMethods[0];
        } else {
            this.selectedAggMethod = this.aggregationMethods[selectedFnIdx];
        }

        // Set up graph aggregation functions
        this.tripsGraphAggFns = [
            {label: this.translate.instant('delay.graphAggDate'), operation: 'date'},
            {label: this.translate.instant('delay.graphAggTrip'), operation: 'trip'}
        ];
        this.tripsGraphSelAggFn = this.tripsGraphAggFns[0];
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

    // Function for stats module switch
    public switchStatsModuleVisibility() {
        if (this.moduleFocus !== 3) {
            this.moduleFocus = 3;
        } else {
            this.moduleFocus = 0;
        }
    }

    // Function for settings module switch
    public switchSettingsModuleVisibility() {
        if (this.moduleFocus !== 4) {
            this.moduleFocus = 4;
            this.delayCategories = this.delayCategoriesService.getDelayCategories();
        } else {
            this.moduleFocus = 0;
        }
    }

    public setToday() {
        this.hooverDates = [new Date()];
    }

    // Download available lines for selected date interval
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
        // Get actual lines
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

    // Load available trip data for another route
    public async changeRoute() {
        if (this.selectedRoute) {
            this.msgService.turnOnLoadingScreenWithoutPercentage();
            this.tripGroups = await this.apiGet('getAvailableTrips', {dates: JSON.stringify(this.queryDates), route_id: this.selectedRoute.id.toString()});
            if (this.tripGroups.length > 0) {
                for (const group of this.tripGroups) {
                    if (group.trips.length > 1) {
                        group.trips.push({
                            id: -1,
                            dep_time: "",
                            dep_time_lab: ""
                        })
                    }

                    this.setUpTripsDepTimes(group.trips);
                }

                this.selectedTripGroup = this.tripGroups[0];
                await this.changeTripGroup();
            }
            this.msgService.turnOffLoadingScreen();
        }
    }

    // Set trips departure time labels according to user language
    public setUpTripsDepTimes(trips: {id: number, dep_time: string, dep_time_lab: string}[]) {
        for (let trip of trips) {
            if (trip.id === -1) {
                trip.dep_time_lab = this.translate.instant("delay.allTrips");
                continue;
            }

            // 24h format
            if (this.translate.currentLang === 'cz') {
                trip.dep_time_lab = trip.dep_time.slice(0, 5);
            // 12h format
            } else {
                let hours = parseInt(trip.dep_time.slice(0, 2));
                if (hours > 12) {
                    trip.dep_time_lab = `${hours - 12}${trip.dep_time.slice(2, 5)} PM`;
                } else {
                    trip.dep_time_lab = `${trip.dep_time.slice(0, 5)} AM`;
                }
            }
        }
    }

    // Change trip group (trips with same route shape)
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

    // Load trip delay data for selected date interval
    public async changeTrip() {
        this.selectedTripData = {};
        if (this.selectedTrip) {
            //  Load delay data for one trip
            if (this.selectedTrip.id !== -1) {
                this.msgService.turnOnLoadingScreenWithoutPercentage();
                let inputData = await this.apiGet('getTripData', {dates: JSON.stringify(this.queryDates), trip_id: this.selectedTrip.id.toString()});
                for (const record in inputData) {
                    if (this.selectedTripData[record] === undefined) {
                        this.selectedTripData[record] = {};
                    }
                    // Save retrieved data according to date and trip id
                    this.selectedTripData[record][this.selectedTrip.id] = inputData[record];
                }
            // Load delay data for whole trip group, e.g. one direction including whole day
            } else if (this.selectedTripGroup) {
                this.msgService.turnOnLoadingScreen();
                this.selectedTripData = {};
                for (const [idx, trip] of this.selectedTripGroup?.trips.entries()) {
                    if (trip.id === -1) {
                        continue;
                    }
                    let inputData = await this.apiGet('getTripData', {dates: JSON.stringify(this.queryDates), trip_id: trip.id.toString()});

                    for (const record in inputData) {
                        if (this.selectedTripData[record] === undefined) {
                            this.selectedTripData[record] = {};
                        }
                        // Save retrieved data according to date and trip id
                        this.selectedTripData[record][trip.id] = inputData[record];
                    }

                    this.msgService.actualLoadingPercentage.next(Math.floor((idx / this.selectedTripGroup?.trips.length) * 100));
                }
            }

            // Put delay data on map
            if (Object.keys(this.selectedTripData).length > 0) {
                this.renderData(true);
            } else {
                this.mapService.clearLayer('route');
                this.mapService.clearLayer('stops');
                this.delayCategoriesService.removeDelayCategoriesFromMap();
                this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDataForSelection.head', 'UIMessagesService.toasts.noAvailableDataForSelection.body');
            }
            this.msgService.turnOffLoadingScreen();
        }
    }

    // Main map render function
    public renderData(focus: boolean) {
        // Clear map layers
        this.mapService.clearLayer('route');
        this.mapService.addNewLayer({name: 'route', palette: {}, layer: undefined, paletteItemName: 'map.zone'});

        this.mapService.clearLayer('stops');
        this.mapService.addNewLayer({name: 'stops', palette: {}, layer: undefined, paletteItemName: 'map.zone'});

        // Clear graph data
        this.tripsGraphData = {labels: [''], datasets: []};

        if (!this.selectedTripGroupShape || !this.selectedTripGroupShape.stops || !this.selectedTripGroupShape.coords) {
            return;
        }

        if (Object.keys(this.selectedTripData).length < 1) {
            return;
        }

        // Show delay categories legend
        this.delayCategoriesService.putDelayCategoriesOnMap();
        // Data for simplified map visualisation
        let stopArrivalDelays = [];

        // Set up graph legend
        // Prepare clear array for data
        let labels: string[] = [this.selectedTripGroupShape.stops[0].stop_name];
        for (const [routePartIdx, routePart] of this.selectedTripGroupShape.coords.entries()) {
            labels.push(this.selectedTripGroupShape.stops[routePartIdx + 1].stop_name);
        }
        this.tripsGraphData.labels = labels;
        // Chart colors
        let chars = ['a', 'b', 'c', 'd'];
        const firstKey = Object.keys(this.selectedTripData)[0];

        // Prepare graph categories
        if (this.tripsGraphSelAggFn?.operation === 'date') {
            for (const [keyIdx, key] of Object.keys(this.selectedTripData).entries()) {
                const graphLabel = timeStamp.getDate(key).toLocaleDateString(this.translate.currentLang);
                this.tripsGraphData.datasets.push(
                    {
                        label: graphLabel,
                        data: Array(this.selectedTripGroupShape.stops.length).fill(null),
                        pointStyle: false,
                        backgroundColor: this.documentStyle.getPropertyValue(`--graph-color-${chars[keyIdx % 4]}`),
                        borderColor: this.documentStyle.getPropertyValue(`--graph-color-${chars[keyIdx % 4]}`)
                    }
                )
            }
        } else {
            for (const [keyIdx, key] of Object.keys(this.selectedTripData[firstKey]).entries()) {
                const graphLabel = this.selectedTripGroup?.trips.find((trip) => { return trip.id === parseInt(key)})?.dep_time_lab;
                this.tripsGraphData.datasets.push(
                    {
                        label: graphLabel,
                        data: Array(this.selectedTripGroupShape.stops.length).fill(null),
                        pointStyle: false,
                        backgroundColor: this.documentStyle.getPropertyValue(`--graph-color-${chars[keyIdx % 4]}`),
                        borderColor: this.documentStyle.getPropertyValue(`--graph-color-${chars[keyIdx % 4]}`)
                    }
                )
            }
        }

        let lastDelayValue: number[] | undefined[] = Array(Object.keys(this.selectedTripData).length).fill(0);

        let actualContinuesDelays: number[][];
        if (this.tripsGraphSelAggFn?.operation === 'date') {
            actualContinuesDelays = Array(Object.keys(this.selectedTripData).length).fill(0).map(() => Array(Object.keys(this.selectedTripData[firstKey]).length).fill(0));
        } else {
            actualContinuesDelays = Array(Object.keys(this.selectedTripData[firstKey]).length).fill(0).map(() => Array(Object.keys(this.selectedTripData).length).fill(0));
        }

        // Put route on map
        for (const [routePartIdx, routePart] of this.selectedTripGroupShape.coords.entries()) {
            let routePartDelay = undefined;

            // Get delay values from last shape part before stop
            let actualStopArrivalDelays: number[] = [];
            for (const dateKey of Object.keys(this.selectedTripData)) {
                for (const tripKey of Object.keys(this.selectedTripData[dateKey])) {
                    if (this.selectedTripData[dateKey][tripKey][routePartIdx]) {
                        actualStopArrivalDelays.push(this.selectedTripData[dateKey][tripKey][routePartIdx][routePart.length - 2]);
                    }
                }
            }

            // Prepare data for graph, take any value between two stops
            if (this.tripsGraphSelAggFn?.operation === 'date') {
                // Set graph data for first stop
                for (const idx in Object.keys(this.selectedTripData)) {
                    this.tripsGraphData.datasets[idx].data[0] = 0;
                }

                for (const [dateIdx, dateKey] of Object.keys(this.selectedTripData).entries()) {
                    for (const [tripIdx, tripKey] of Object.keys(this.selectedTripData[dateKey]).entries()) {
                        if (this.selectedTripData[dateKey][tripKey][routePartIdx] &&
                            this.selectedTripData[dateKey][tripKey][routePartIdx][routePart.length - 2] !== undefined) {
                                actualContinuesDelays[dateIdx][tripIdx] = this.selectedTripData[dateKey][tripKey][routePartIdx][routePart.length - 2];
                        }
                    }
                    lastDelayValue[dateIdx] = this.getActualDelayValue(actualContinuesDelays[dateIdx]);
                }

                // Set up graph data
                for (const idx in Object.keys(this.selectedTripData)) {
                    this.tripsGraphData.datasets[idx].data[routePartIdx + 1] = lastDelayValue[idx];
                }
            } else {
                // Set graph data for first stop
                for (const idx in Object.keys(this.selectedTripData[firstKey])) {
                    this.tripsGraphData.datasets[idx].data[0] = 0;
                }

                for (const [tripIdx, tripKey] of Object.keys(this.selectedTripData[firstKey]).entries()) {
                    for (const [dateIdx, dateKey] of Object.keys(this.selectedTripData).entries()) {
                        if (this.selectedTripData[dateKey][tripKey] && this.selectedTripData[dateKey][tripKey][routePartIdx] !== undefined &&
                            this.selectedTripData[dateKey][tripKey][routePartIdx][routePart.length - 2] !== undefined) {
                                actualContinuesDelays[tripIdx][dateIdx] = this.selectedTripData[dateKey][tripKey][routePartIdx][routePart.length - 2];
                        }
                    }
                    lastDelayValue[tripIdx] = this.getActualDelayValue(actualContinuesDelays[tripIdx]);
                }

                // Set up graph data
                for (const idx in Object.keys(this.selectedTripData[firstKey])) {
                    this.tripsGraphData.datasets[idx].data[routePartIdx + 1] = lastDelayValue[idx];
                }
            }

            stopArrivalDelays.push(actualStopArrivalDelays);
            // Count one delay value defined by selected aggregation function for whole route part between two stops
            routePartDelay = this.getActualDelayValue(actualStopArrivalDelays);

            // Put route part on map
            // In case of simplified visualization there will be only one value for whole route part
            if (this.showSimplifiedDelays) {
                // Get delay category according to actual delay value
                const delayCategory = this.delayCategoriesService.getDelayCategoryByValue(routePartDelay);
                const routePartName = `${this.selectedTripGroupShape.stops[routePartIdx].stop_name} -> ${this.selectedTripGroupShape.stops[routePartIdx + 1].stop_name}`;
    
                // Put route part on map
                let mapRoutePart: mapObject = {
                    layerName: 'route',
                    type: 'route',
                    focus: false,
                    latLng: routePart.map((part) => { return {lat: part[0], lng: part[1]}}),
                    color: 'provided',
                    metadata: {
                        route_name: routePartName,
                        color: delayCategory.color,
                        delay_value: this.showDelayValueLabel ? routePartDelay : undefined,
                        agg_method: this.selectedAggMethod?.operation
                    },
                    interactive: routePartDelay === undefined || !this.showDelayValueLabel ? false : true,
                    hoover: true
                }

                this.mapService.addToLayer(mapRoutePart);
            // In case of detailed visualization there will be exact value from DB for exact route part
            } else {
                for (let idx = 0; idx < (routePart.length - 1); idx++) {
                    let delay = undefined;
                    let delays: number[] = [];
                    for (const dateKey of Object.keys(this.selectedTripData)) {
                        for (const tripKey of Object.keys(this.selectedTripData[dateKey])) {
                            if (this.selectedTripData[dateKey][tripKey][routePartIdx]) {
                                delays.push(this.selectedTripData[dateKey][tripKey][routePartIdx][idx]);
                            }
                        }
                    }
                    delay = this.getActualDelayValue(delays);
                    // Get delay category according to actual delay value
                    const delayCategory = this.delayCategoriesService.getDelayCategoryByValue(delay);
    
                    // Put route part on map
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
                        interactive: delay === undefined || !this.showDelayValueLabel ? false : true,
                        hoover: true
                    }
    
                    this.mapService.addToLayer(mapRoutePart);
                }
            }
        }

        this.tripsGraphData.datasets.sort((a, b) => { return a.label > b.label ? 1 : -1});

        // Put stops on map
        for (const [idx, stop] of this.selectedTripGroupShape.stops.entries()) {
            let mapStop: mapObject = {
                layerName: 'stops',
                type: 'stop',
                focus: false,
                latLng: [{lat: stop.coords[0], lng: stop.coords[1]}],
                color: 'provided',
                metadata: {
                    stop_name: stop.stop_name,
                    delays: idx < 1 ? [] : stopArrivalDelays[idx - 1]
                },
                interactive: true,
                hoover: false
            }

            this.mapService.addToLayer(mapStop);
        }

        // In some use cases map should not focus on new objects
        if (focus) {
            this.mapService.fitToLayer('stops');
        }
    }

    // Combine delay values from multiple days or trips intro one using selected aggregation method
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

    // Close open control module
    public closeRouteModule() {
        this.moduleFocus = 0;
    }

    // Delay categories CRUD functions
    // Actualize delay category
    public onDelayCategoryChange(idx: number) {
        this.delayCategoriesService.setDelayCategory(idx, this.delayCategories[idx]);
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }

    // Remove delay category
    public removeDelayCategory(idx: number) {
        this.delayCategoriesService.removeDelayCategory(idx);
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }

    // Add new delay category
    public addDelayCategory() {
        this.delayCategoriesService.addNewDelayCategory();
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }

    // Return delay categories to default state
    public resetDelayCategories() {
        this.delayCategoriesService.resetDelayCategories();
        this.delayCategories = this.delayCategoriesService.getDelayCategories();
        this.renderData(false);
    }
}