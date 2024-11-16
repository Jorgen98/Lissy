import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';

interface lineGraphData {
  labels: string[],
  datasets: any[]
};

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
  constructor(
    private apiService: APIService,
    public translate: TranslateService
  ) {}

  public isCalendarModuleActive: boolean = false;
  public isTodayFunctionEnabled: boolean = false;

  public selectedDates: Date[] = [];
  public hooverDates: Date[] | null = null;
  public startDate: Date = new Date();
  public disabledDates: Date[] = [];
  public endDate: Date = new Date();

  public documentStyle = getComputedStyle(document.documentElement);
  public graphOptions = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { labels: { color: this.documentStyle.getPropertyValue('--gray-50')}},
      tooltip: {}
    },
    scales: {
      x: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50')}, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }},
      y: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }}
    }
  };
  public graphTimeOptions = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { labels: { color: this.documentStyle.getPropertyValue('--gray-50')}},
      tooltip: {
        callbacks: {
          label: function(context: any) {
              return `${Math.floor((parseInt(context.parsed.y) / 1000) / 60)}min ${Math.floor((parseInt(context.parsed.y) / 1000) % 60)}s`;
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50')}, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }},
      y: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }}
    }
  };
  public systemState: lineGraphData[] = [];
  public systemStateTypes: string[] = [
    "gtfs_routes",
    "gtfs_routes_added",
    "gtfs_shapes",
    "gtfs_shapes_added",
    "gtfs_stops",
    "gtfs_stops_added",
    "gtfs_trips",
    "gtfs_trips_added",
  ];
  public systemStateProcessingTime: lineGraphData = {labels: [], datasets: []};

  // Help function for api requests heading
  private async apiGet(url: string, params?: {[name: string]: string}) {
    return await this.apiService.genericGet(`${config.apiPrefix}/${url}`, params);
  }

  // On component creation
  public async ngOnInit() {
    let apiDates = await this.apiGet('availableDates');

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
    this.renderData();
  }

  // Function for calendar module switch
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

  // Render graph data
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
    let queryData = await this.apiGet('statistics', {dates: JSON.stringify(queryDates)});

    // Transform data and render them
    this.systemState = [];
    this.systemStateProcessingTime = {labels: [''], datasets: []};

    // Transit system state
    for (let i = 0; i < this.systemStateTypes.length; i+=2) {
      this.systemState.push(
        {
          labels: [],
          datasets: [
            {
              label: this.translate.instant('stats.systemStateActual'),
              data: [],
              backgroundColor: this.documentStyle.getPropertyValue('--graph-color-a')
            },
            {
              label: this.translate.instant('stats.systemStateNew'),
              data: [],
              backgroundColor: this.documentStyle.getPropertyValue('--graph-color-b')
            }
          ]
        }
      )
    }

    // Transit system state processing time
    this.systemStateProcessingTime.datasets.push(
      {
        label: this.translate.instant('stats.systemStateActual'),
        data: [null],
        borderColor: this.documentStyle.getPropertyValue('--graph-color-a'),
        tension: 0.4
      }
    )

    // Parse data
    for (const day in queryData) {
      let date = (new Date(parseInt(day))).toLocaleDateString('cs-CZ', {dateStyle: 'medium'});

      for (let i = 0; i < this.systemState.length; i++) {
        this.systemState[i].labels.push(date);
        this.systemState[i].datasets[0].data.push(queryData[day][this.systemStateTypes[i * 2]]);
        this.systemState[i].datasets[1].data.push(queryData[day][this.systemStateTypes[i * 2 + 1]]);
      }

      this.systemStateProcessingTime.labels.push(date);
      this.systemStateProcessingTime.datasets[0].data.push(queryData[day]['gtfs_processing_time']);
    }

    this.systemStateProcessingTime.labels.push('');
    this.systemStateProcessingTime.datasets[0].data.push(null);

    console.log(this.systemStateProcessingTime)
  }
}