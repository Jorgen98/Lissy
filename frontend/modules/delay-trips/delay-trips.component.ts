import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';
import { MapComponent } from '../../src/app/map/map.component';
import { mapObject, MapService } from '../../src/app/map/map.service';

interface route {
  route_short_name: string,
  id: number
}

interface trip {
  id: number,
  dep_time: number,
  dep_time_lab: string
}

interface tripGroup {
  shape_id: number,
  stops: string,
  trips: trip[]
}

@Component({
  selector: 'delay-trips',
  standalone: true,
  imports: [ ImportsModule, MapComponent ],
  templateUrl: './delay-trips.component.html',
  styleUrl: './delay-trips.component.css'
})

export class DelayTripsModule implements OnInit {
  static modulConfig: ModuleConfig = config;
  public config: ModuleConfig = config;
  constructor(
    private apiService: APIService,
    public translate: TranslateService,
    public mapService: MapService
  ) {}

  public moduleFocus: Number = 0;
  public isTodayFunctionEnabled: boolean = true;
  public isRouteSelectionEnabled: boolean = true;

  public selectedDates: Date[] | null = null;
  public hooverDates: Date[] | null = null;
  public startDate: Date = new Date();
  public disabledDates: Date[] = [];
  public endDate: Date = new Date();

  public queryDates: Number[][] = [];

  public routes: route[] = [];
  public selectedRoute: route | undefined = undefined;
  public tripGroups: tripGroup[] = [];
  public selectedTripGroup: tripGroup | undefined = undefined;
  public selectedTrip: trip | undefined = undefined;
  public selectedTripGroupShape: {stops: any[], coords: number[][]} | undefined = undefined;
  public selectedTripData: {[date_key: number]: {[path_group_index: number]: {[path_index: number]: number}}} = {};

  // Help function for api requests heading
  private async apiGet(url: string, params?: {[name: string]: string}) {
    return await this.apiService.genericGet(`${config.apiPrefix}/${url}`, params);
  }

  // On component creation
  public async ngOnInit() {
    let apiDates = await this.apiGet('availableDates');

    if (apiDates.start === undefined || apiDates.end === undefined) {
      this.startDate = new Date();
      this.disabledDates.push(new Date());
      this.endDate = new Date();
      this.isTodayFunctionEnabled = false;
      return;
    }

    this.startDate = new Date(apiDates.start);
    for (const date of apiDates.disabled) {
      this.disabledDates.push(new Date(date));
    }
    this.endDate = new Date(apiDates.end);

    this.selectedDates = [new Date(apiDates.end)];
    this.hooverDates = [new Date(apiDates.end)];

    // Get dates, when stats are available
    if (!this.disabledDates.find((date) => {return date.valueOf() === (new Date()).setHours(0, 0, 0, 0)}) &&
      this.startDate.valueOf() <= (new Date()).setHours(0, 0, 0, 0) && (new Date()).setHours(0, 0, 0, 0) <= this.endDate.valueOf()) {
      this.isTodayFunctionEnabled = true;
    }

    // Get stats for latest date
    await this.downloadRoutesData();
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

  public setToday() {
    this.hooverDates = [new Date()];
  }

  public async downloadRoutesData() {
    if (this.hooverDates === null) {
      return;
    }

    this.queryDates = [];

    this.hooverDates.sort((a, b) => { return a.valueOf() > b.valueOf() ? 1 : -1});

    this.selectedDates = [];
    for (const date of this.hooverDates) {
      this.selectedDates.push(new Date(date));
    }

    // Get data for selected dates
    let day = 24 * 60 * 60 * 1000;
    let actualDate = this.hooverDates[0].valueOf();
    let isGoing = true;
    this.queryDates.push([actualDate]);
    while (actualDate < (this.hooverDates[this.hooverDates.length - 1].valueOf() + day)) {
      if (isGoing && this.hooverDates.findIndex((date) => {return actualDate === date.valueOf()}) === -1) {
        this.queryDates[this.queryDates.length - 1].push(actualDate - day);
        isGoing = false;
      } else if (!isGoing && this.hooverDates.findIndex((date) => {return actualDate === date.valueOf()}) !== -1) {
        this.queryDates.push([actualDate]);
        isGoing = true;
      }
      actualDate += day;
    }
    this.queryDates[this.queryDates.length - 1].push(this.hooverDates[this.hooverDates.length - 1].valueOf());

    // API call for data
    this.routes = await this.apiGet('getAvailableRoutes', {dates: JSON.stringify(this.queryDates)});
    if (this.routes.length > 0) {
      this.isRouteSelectionEnabled = true;
      this.selectedRoute = this.routes[0];
      await this.changeRoute();
    } else {
      this.isRouteSelectionEnabled = false;
    }
    this.moduleFocus = 0;
  }

  public async changeRoute() {
    if (this.selectedRoute) {
      this.tripGroups = await this.apiGet('getAvailableTrips', {dates: JSON.stringify(this.queryDates), route_id: this.selectedRoute.id.toString()});
      if (this.tripGroups.length > 0) {
        for (const group of this.tripGroups) {
          for (let trip of group.trips) {
            trip.dep_time_lab = (new Date(trip.dep_time)).toLocaleTimeString();
          }
        }

        this.selectedTripGroup = this.tripGroups[0];
        await this.changeTripGroup();
      }
    }
  }

  public async changeTripGroup() {
    if (this.selectedTripGroup && this.selectedTripGroup.trips.length > 0) {
      this.selectedTripGroupShape = await this.apiGet('getShape', {shape_id: this.selectedTripGroup.shape_id.toString()});

      this.selectedTrip = this.selectedTripGroup.trips[0];
      await this.changeTrip();
    }
  }

  public async changeTrip() {
    if (this.selectedTrip) {
      this.selectedTripData = await this.apiGet('getTripData', {dates: JSON.stringify(this.queryDates), trip_id: this.selectedTrip.id.toString()});

      if (Object.keys(this.selectedTripData).length > 0) {
        this.renderData();
      }
    }
  }

  public renderData() {
    this.mapService.removeLayer('route');
    this.mapService.addNewLayer({name: 'route', palette: {}, layer: undefined, paletteItemName: 'map.zon'});

    this.mapService.removeLayer('stops');
    this.mapService.addNewLayer({name: 'stops', palette: {}, layer: undefined, paletteItemName: 'map.zone'});

    if (!this.selectedTripGroupShape || !this.selectedTripGroupShape.stops || !this.selectedTripGroupShape.coords) {
      return;
    }

    for (const stop of this.selectedTripGroupShape.stops) {
      let mapStop: mapObject = {
        layerName: 'stops',
        type: 'stop',
        focus: false,
        latLng: [{lat: stop.coords[0], lng: stop.coords[1]}],
        color: 'provided',
        metadata: {
          stop_name: stop.stop_name
        }
      }

      this.mapService.addToLayer(mapStop);
    }
/*
    for (const routePart of mapData.coords) {
      let mapRoutePart: mapObject = {
        layerName: 'route',
        type: 'route',
        focus: false,
        latLng: routePart.map((coord: any) => {return {lat: coord[0], lng: coord[1]}}),
        color: 'provided',
        metadata: {
          color: this.selectedRoute?.route_color
        }
      }

      this.mapService.addToLayer(mapRoutePart);
    }*/

    this.mapService.fitToLayer('stops');
  }

  public closeRouteModule() {
    this.moduleFocus = 0;
  }
}