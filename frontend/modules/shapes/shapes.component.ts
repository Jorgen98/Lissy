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
  selector: 'shapes',
  standalone: true,
  imports: [ ImportsModule, MapComponent ],
  templateUrl: './shapes.component.html',
  styleUrl: './shapes.component.css'
})

export class ShapesModule implements OnInit {
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

  public selectedDate: Date | null = null;
  public hooverDate: Date | null = null;
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

    this.selectedDate = new Date(apiDates.end);
    this.hooverDate = new Date(apiDates.end);

    // Get dates, when line shapes are available
    if (!this.disabledDates.find((date) => {return date.valueOf() === (new Date()).setHours(0, 0, 0, 0)}) &&
      this.startDate.valueOf() <= (new Date()).setHours(0, 0, 0, 0) && (new Date()).setHours(0, 0, 0, 0) <= this.endDate.valueOf()) {
      this.isTodayFunctionEnabled = true;
    }

    // Get available shapes for latest available day
    this.getAvailableShapesData();
  }

  // Function for calendar module switch
  public switchCalendarModuleVisibility() {
    if (this.moduleFocus !== 1 && this.selectedDate !== null) {
      this.hooverDate = new Date(JSON.parse(JSON.stringify(this.selectedDate)));
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
    this.hooverDate = new Date();
  }

  // Get available shapes for selected date
  public async getAvailableShapesData() {
    this.moduleFocus === 0;

    if (this.hooverDate === null) {
      return;
    }

    this.selectedDate = new Date(JSON.parse(JSON.stringify(this.hooverDate)));

    // API call for data
    this.routes = await this.apiGet('getShapes', {date: this.hooverDate.valueOf().toString()});

    if (this.routes.length < 1) {
      this.isRouteSelectionEnabled = false;
      this.selectedRoute = undefined;
      this.selectedTrip = undefined;
    } else {
      this.isRouteSelectionEnabled = true;
      this.selectedRoute = this.routes[0];
      this.selectedTrip = this.selectedRoute?.trips[0];
    }

    await this.renderData();
    this.moduleFocus = 0;
  }

  public changeRoute() {
    this.selectedTrip = this.selectedRoute?.trips[0];
    this.renderData();
  }

  public async renderData() {
    this.mapService.removeLayer('route');
    this.mapService.addNewLayer({name: 'route', palette: {}, layer: undefined, paletteItemName: 'map.zon'});

    this.mapService.removeLayer('stops');
    this.mapService.addNewLayer({name: 'stops', palette: {}, layer: undefined, paletteItemName: 'map.zone'});

    if (!this.selectedTrip?.shape_id) {
      return;
    }

    let mapData = await this.apiGet('getShape', {shape_id: JSON.stringify(this.selectedTrip?.shape_id)});

    if (!mapData.stops || !mapData.coords) {
      return;
    }

    for (const stop of mapData.stops) {
      let mapStop: mapObject = {
        layerName: 'stops',
        type: 'stop',
        focus: false,
        latLng: [{lat: stop.coords[0], lng: stop.coords[1]}],
        color: 'palette',
        metadata: {
          stop_name: stop.stop_name,
          wheelchair_boarding: stop.wheelchair_boarding,
          zone_id: stop.zone_id
        }
      }

      this.mapService.addToLayer(mapStop);
    }

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
    }

    this.mapService.fitToLayer('stops');
  }

  public closeRouteModule() {
    this.moduleFocus = 0;
  }
}