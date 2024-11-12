import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { ImportsModule } from '../../src/app/imports';

@Component({
  selector: 'stats',
  standalone: true,
  imports: [ ImportsModule ],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.css'
})

export class StatsModule implements OnInit {
  static modulConfig: ModuleConfig = config;
  public config: ModuleConfig = config;
  constructor(private apiService: APIService) {}

  public isCalendarModuleActive: boolean = false;
  public isTodayFunctionEnabled: boolean = false;

  public selectedDates: Date[] = [];
  public hooverDates: Date[] | null = null;
  public startDate: Date = new Date();
  public disabledDates: Date[] = [];
  public endDate: Date = new Date();

  private async apiGet(url: string, params?: {[name: string]: string}) {
    return await this.apiService.genericGet(`${config.apiPrefix}/${url}`, params);
  }

  public async ngOnInit() {
    let apiDates = await this.apiGet('availableDates');

    this.startDate = new Date(apiDates.start);
    for (const date of apiDates.disabled) {
      this.disabledDates.push(new Date(date));
    }
    this.endDate = new Date(apiDates.end);

    this.selectedDates = [new Date(apiDates.end)];
    this.hooverDates = [new Date(apiDates.end)];

    if (!this.disabledDates.find((date) => {return date.valueOf() === (new Date()).setHours(0, 0, 0, 0)}) &&
      this.startDate.valueOf() <= (new Date()).setHours(0, 0, 0, 0) && (new Date()).setHours(0, 0, 0, 0) <= this.endDate.valueOf()) {
      this.isTodayFunctionEnabled = true;
    }

    this.renderData();
  }

  public switchCalendarModuleVisibility() {
    if (!this.isCalendarModuleActive) {
      this.hooverDates = [];
      for (const date of this.selectedDates) {
        this.hooverDates.push(new Date(date));
      }
    }
    this.isCalendarModuleActive = !this.isCalendarModuleActive;
  }

  public setToday() {
    this.hooverDates = [new Date()];
  }

  public async renderData() {
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

    let day = 24 * 60 * 60 * 1000;
    let actualDate = this.hooverDates[0].valueOf();
    let isGoing = false;
    queryDates.push([actualDate]);
    while (actualDate < (this.hooverDates[this.hooverDates.length - 1].valueOf())) {
        if (isGoing && this.hooverDates.findIndex((date) => {return actualDate === date.valueOf()}) === -1) {
          queryDates[queryDates.length - 1].push(actualDate);
          isGoing = false;
        } else if (isGoing && this.hooverDates.findIndex((date) => {return actualDate === date.valueOf()}) === -1) {
          queryDates.push([actualDate]);
          isGoing = true;
        }
        actualDate += day;
    }
    queryDates[queryDates.length - 1].push(this.hooverDates[this.hooverDates.length - 1].valueOf());

    let data = await this.apiGet('operationStats', {dates: JSON.stringify(queryDates)});
    console.log(data);
  }
}