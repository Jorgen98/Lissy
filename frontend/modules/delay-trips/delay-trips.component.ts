import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';
import { MapComponent } from '../../src/app/map/map.component';
import { mapObject, MapService } from '../../src/app/map/map.service';

interface route {
  route_color: string,
  route_short_name: string,
  trips: {
    shape_id: string
    stops: string
  } []
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
  public isCalendarModuleActive: boolean = false;
  public isTodayFunctionEnabled: boolean = true;
  public isRouteSelectionEnabled: boolean = true;

  public selectedDates: Date[] | null = null;
  public hooverDates: Date[] | null = null;
  public startDate: Date = new Date();
  public disabledDates: Date[] = [];
  public endDate: Date = new Date();

  public routes: route[] = [];
  public selectedRoute: route | undefined = undefined;
  public selectedTrip: { shape_id: string, stops: string} | undefined = undefined;

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
    this.downloadData();
  }

  // Function for calendar module switch
  public switchCalendarModuleVisibility() {
    if (!this.isCalendarModuleActive && this.selectedDates !== null) {
      this.hooverDates = [];
      for (const date of this.selectedDates) {
        this.hooverDates.push(new Date(date));
      }
    }
    this.isCalendarModuleActive = !this.isCalendarModuleActive;
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

  public async downloadData() {
    this.isCalendarModuleActive = false;

    if (this.hooverDates === null) {
      return;
    }

    let queryDates: Number[][] = [];

    this.hooverDates.sort((a, b) => { return a.valueOf() > b.valueOf() ? 1 : -1});

    this.selectedDates = [];
    for (const date of this.hooverDates) {
      this.selectedDates.push(new Date(date));
    }

    // Get data for selected dates
    let day = 24 * 60 * 60 * 1000;
    let actualDate = this.hooverDates[0].valueOf();
    let isGoing = true;
    queryDates.push([actualDate]);
    while (actualDate < (this.hooverDates[this.hooverDates.length - 1].valueOf() + day)) {
      if (isGoing && this.hooverDates.findIndex((date) => {return actualDate === date.valueOf()}) === -1) {
        queryDates[queryDates.length - 1].push(actualDate - day);
        isGoing = false;
      } else if (!isGoing && this.hooverDates.findIndex((date) => {return actualDate === date.valueOf()}) !== -1) {
        queryDates.push([actualDate]);
        isGoing = true;
      }
      actualDate += day;
    }
    queryDates[queryDates.length - 1].push(this.hooverDates[this.hooverDates.length - 1].valueOf());

    // API call for data
    let intervalRoutes = await this.apiGet('getAvailableRoutes', {dates: JSON.stringify(queryDates)});
    let intervalTrips = await this.apiGet('getAvailableTrips', {dates: JSON.stringify(queryDates), route_id: intervalRoutes[0].id});
    let shape = await this.apiGet('getShape', {shape_id: intervalTrips[0].shape_id});
    console.log(intervalTrips)

    // To do: get trip delay data
  }
}