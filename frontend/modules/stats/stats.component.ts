import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';
import { UIMessagesService } from '../../src/app/services/messages';
import * as timeStamp from "../../src/app/services/timeStamps";

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
    public translate: TranslateService,
    private msgService: UIMessagesService
  ) {}

  public queryData: any;

  public isDateSelectionEnabled: boolean = true;

  public isCalendarModuleActive: boolean = false;
  public isTodayFunctionEnabled: boolean = false;
  public isRoutingDataAvailable: boolean = false;

  public selectedDates: Date[] | null = null;
  public hooverDates: Date[] | null = null;
  public startDate: Date = new Date();
  public disabledDates: Date[] = [];
  public endDate: Date = new Date();

  // Graph options according to type
  public documentStyle = getComputedStyle(document.documentElement);
  public graphOptions = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }},
      y: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }}
    }
  };
  public graphOptionsLegend = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { labels: { color: this.documentStyle.getPropertyValue('--gray-50') }},
    },
    scales: {
      x: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }},
      y: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }}
    }
  };
  public graphTimeOptions = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            let hours = Math.floor(((parseInt(context.parsed.y) / 1000) / 60) / 60);
            let mins = Math.floor((parseInt(context.parsed.y) / 1000) / 60);
            let secs = Math.floor((parseInt(context.parsed.y) / 1000) % 60);
            return `${hours > 0 ? hours + "h" : ""} ${mins > 0 ? mins + "m" : ""} ${secs > 0 ? secs + "s" : ""}`;
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }},
      y: { ticks: { display: false }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }}
    }
  };
  public graphTimeOptionsLegend = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { labels: { color: this.documentStyle.getPropertyValue('--gray-50')} },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            let hours = Math.floor(((parseInt(context.parsed.y) / 1000) / 60) / 60);
            let mins = Math.floor((parseInt(context.parsed.y) / 1000) / 60);
            let secs = Math.floor((parseInt(context.parsed.y) / 1000) % 60);
            return `${hours > 0 ? hours + "h" : ""} ${mins > 0 ? mins + "m" : ""} ${secs > 0 ? secs + "s" : ""}`;
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: this.documentStyle.getPropertyValue('--gray-50') }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }},
      y: { ticks: { display: false }, grid: { color: this.documentStyle.getPropertyValue('--gray-500'), drawBorder: false }}
    }
  };
  public graphOptionsDoughnut = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { labels: { color: this.documentStyle.getPropertyValue('--gray-50') } }
    },
    scales: {
      x: { ticks: { display: false }, grid: { display: false }},
      y: { ticks: { display: false }, grid: { display: false }}
    }
  };
  public graphOptionsDoughnutBinary = {
    maintainAspectRatio: false,
    aspectRatio: 1,
    plugins: {
      legend: { labels: { color: this.documentStyle.getPropertyValue('--gray-50') } },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            return `${Math.floor(context.parsed / (context.dataset.data.reduce((total: number, value: number) => { return total + value })) * 100)}%`;
          }
        }
      }
    },
    scales: {
      x: { ticks: { display: false }, grid: { display: false }},
      y: { ticks: { display: false }, grid: { display: false }}
    }
  };
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

  // Graph datasets
  public systemState: lineGraphData[] = [];
  public systemStateProcessingTime: lineGraphData = {labels: [], datasets: []};
  public systemStateRoutingTypes: lineGraphData = {labels: [], datasets: []};
  public systemStateRoutingSuccess: lineGraphData = {labels: [], datasets: []};
  public systemStateRoutingTime: lineGraphData = {labels: [], datasets: []};
  public processingTimes: lineGraphData = {labels: [], datasets: []};
  public processingDataAll: lineGraphData = {labels: [], datasets: []};
  public processingDataDownload: lineGraphData = {labels: [], datasets: []};
  public processingDataSaved: lineGraphData = {labels: [], datasets: []};
  public processingTripsAll: lineGraphData = {labels: [], datasets: []};
  public processingTripsPlanned: lineGraphData = {labels: [], datasets: []};
  public processingTripsExtra: lineGraphData = {labels: [], datasets: []};

  // Help function for api requests heading
  private async apiGet(url: string, params?: {[name: string]: string}) {
    return await this.apiService.genericGet(`${config.apiPrefix}/${url}`, params);
  }

  // On component creation
  public async ngOnInit() {
    if(!await this.apiService.isConnected()) {
      this.isDateSelectionEnabled = false;
      this.msgService.showMessage('error', 'UIMessagesService.toasts.dbConnectError.head', 'UIMessagesService.toasts.dbConnectError.body');
      return;
    }

    let apiDates = await this.apiGet('availableDates');

    if (apiDates.start === undefined || apiDates.end === undefined) {
      this.startDate = new Date(new Date().getTime());
      this.disabledDates.push(new Date(new Date().getTime()));
      this.endDate = new Date(new Date().getTime());
      this.isTodayFunctionEnabled = false;
      this.isDateSelectionEnabled = false;
      this.msgService.showMessage('warning', 'UIMessagesService.toasts.noAvailableDates.head', 'UIMessagesService.toasts.noAvailableDates.body');
      return;
    }

    this.startDate = timeStamp.getDate(apiDates.start);
    for (const date of apiDates.disabled) {
      this.disabledDates.push(timeStamp.getDate(date));
    }
    this.endDate = timeStamp.getDate(apiDates.end);

    this.selectedDates = [timeStamp.getDate(apiDates.end)];
    this.hooverDates = [timeStamp.getDate(apiDates.end)];

    // Get dates, when stats are available
    if (!this.disabledDates.find((date) => {return date.valueOf() === (new Date()).setHours(0, 0, 0, 0)}) &&
      this.startDate.valueOf() <= (new Date()).setHours(0, 0, 0, 0) && (new Date()).setHours(0, 0, 0, 0) <= this.endDate.valueOf()) {
      this.isTodayFunctionEnabled = true;
    }

    // Get stats for latest date
    this.downloadData();

    this.translate.onLangChange.subscribe(() => {
      this.renderData();
    });
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

  public setToday() {
    this.hooverDates = [new Date()];
  }

  // Render graph data
  public async downloadData() {
    this.isCalendarModuleActive = false;

    if (this.hooverDates === null) {
      return;
    }

    this.msgService.turnOnLoadingScreenWithoutPercentage();
    let queryDates: string[][] = [];

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
    queryDates.push([actualDate]);
    while (timeStamp.compareTimeStamps(actualDate, timeStamp.addOneDayToTimeStamp(UTCHooverDates[UTCHooverDates.length - 1])) !== 1) {
      if (isGoing && UTCHooverDates.findIndex((date) => {return actualDate === date}) === -1) {
        queryDates[queryDates.length - 1].push(timeStamp.removeOneDayFromTimeStamp(actualDate));
        isGoing = false;
      } else if (!isGoing && UTCHooverDates.findIndex((date) => {return actualDate === date}) !== -1) {
        queryDates.push([actualDate]);
        isGoing = true;
      }
      actualDate = timeStamp.addOneDayToTimeStamp(actualDate);
    }
    queryDates[queryDates.length - 1].push(UTCHooverDates[UTCHooverDates.length - 1]);

    // API call for data
    this.queryData = await this.apiGet('statistics', {dates: JSON.stringify(queryDates)});

    this.renderData();
    this.msgService.turnOffLoadingScreen();
  }

  public renderData(){
    // Transform data and render them
    // Clear actual data
    this.systemState = [];
    this.systemStateProcessingTime = {labels: [''], datasets: []};
    this.systemStateRoutingTypes = {labels: [
      this.translate.instant('stats.systemStateRoutingRail'),
      this.translate.instant('stats.systemStateRoutingRoad'),
      this.translate.instant('stats.systemStateRoutingTram')
    ], datasets: [{
      label: '',
      data: [0, 0, 0],
      backgroundColor: [
        this.documentStyle.getPropertyValue('--graph-color-a'),
        this.documentStyle.getPropertyValue('--graph-color-b'),
        this.documentStyle.getPropertyValue('--graph-color-c')
      ],
      borderColor: this.documentStyle.getPropertyValue('--background')
    }]};
    this.systemStateRoutingSuccess = {labels: [
      this.translate.instant('stats.systemStateRoutingSuccessOk'),
      this.translate.instant('stats.systemStateRoutingSuccessNotOk')
    ], datasets: [{
      label: '',
      data: [0, 0],
      backgroundColor: [
        this.documentStyle.getPropertyValue('--graph-color-c'),
        this.documentStyle.getPropertyValue('--graph-color-d')
      ],
      borderColor: this.documentStyle.getPropertyValue('--background')
    }]};
    this.systemStateRoutingTime = {labels: [''], datasets: []};
    this.isRoutingDataAvailable = false;

    this.processingTimes = {labels: [''], datasets: []};
    this.processingDataAll = {labels: [
      this.translate.instant('stats.processingDataSavedRecords'),
      this.translate.instant('stats.processingDataDroppedRecords')
    ], datasets: [{
      label: '',
      data: [0, 0],
      backgroundColor: [
        this.documentStyle.getPropertyValue('--graph-color-a'),
        this.documentStyle.getPropertyValue('--graph-color-b')
      ],
      borderColor: this.documentStyle.getPropertyValue('--background')
    }]};
    this.processingDataDownload = {labels: [], datasets: [{
      label: '',
      data: [],
      backgroundColor: this.documentStyle.getPropertyValue('--graph-color-a'),
    }]};
    this.processingDataSaved = {labels: [], datasets: [{
      label: '',
      data: [],
      backgroundColor: this.documentStyle.getPropertyValue('--graph-color-b'),
    }]};
    this.processingTripsAll = {labels: [
      this.translate.instant('stats.processingDataTripsRateSuccess'),
      this.translate.instant('stats.processingDataTripsRateFail')
    ], datasets: [{
      label: '',
      data: [0, 0],
      backgroundColor: [
        this.documentStyle.getPropertyValue('--graph-color-c'),
        this.documentStyle.getPropertyValue('--graph-color-d'),
      ],
      borderColor: this.documentStyle.getPropertyValue('--background')
    }]};
    this.processingTripsPlanned = {labels: [], datasets: [{
      label: '',
      data: [],
      backgroundColor: this.documentStyle.getPropertyValue('--graph-color-c'),
    }]};
    this.processingTripsExtra = {labels: [], datasets: [{
      label: '',
      data: [],
      backgroundColor: this.documentStyle.getPropertyValue('--graph-color-d'),
    }]};

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
              backgroundColor: this.documentStyle.getPropertyValue('--graph-color-b'),
            }
          ]
        }
      )
    }

    // Transit system state processing time
    this.systemStateProcessingTime.datasets.push(
      {
        label: '',
        data: [null],
        borderColor: this.documentStyle.getPropertyValue('--graph-color-a'),
        backgroundColor: this.documentStyle.getPropertyValue('--graph-color-a')
      }
    )

    // Transit system state routing time
    this.systemStateRoutingTime.datasets.push(
      {
        label: '',
        data: [null],
        borderColor: this.documentStyle.getPropertyValue('--graph-color-a'),
        backgroundColor: this.documentStyle.getPropertyValue('--graph-color-a')
      }
    )

    // Processing data times
    this.processingTimes.datasets.push(
      {
        label: this.translate.instant('stats.processingDataTimeDownload'),
        data: [null],
        borderColor: this.documentStyle.getPropertyValue('--graph-color-a'),
        backgroundColor: this.documentStyle.getPropertyValue('--graph-color-a')
      },
      {
        label: this.translate.instant('stats.processingDataTimeProcessing'),
        data: [null],
        borderColor: this.documentStyle.getPropertyValue('--graph-color-b'),
        backgroundColor: this.documentStyle.getPropertyValue('--graph-color-b')
      },
      {
        label: this.translate.instant('stats.processingDataTimeAll'),
        data: [null],
        borderColor: this.documentStyle.getPropertyValue('--graph-color-c'),
        backgroundColor: this.documentStyle.getPropertyValue('--graph-color-c')
      }
    )

    // Parse data
    for (const day in this.queryData) {
      let date = (timeStamp.getDate(day)).toLocaleDateString(this.translate.currentLang === 'cz' ? 'cs-CZ' : 'en-GB', {dateStyle: 'medium'});

      for (let i = 0; i < this.systemState.length; i++) {
        this.systemState[i].labels.push(date);
        this.systemState[i].datasets[0].data.push(this.queryData[day][this.systemStateTypes[i * 2]]);
        this.systemState[i].datasets[1].data.push(this.queryData[day][this.systemStateTypes[i * 2 + 1]]);
      }

      this.systemStateProcessingTime.labels.push(date);
      this.systemStateProcessingTime.datasets[0].data.push(this.queryData[day]['gtfs_processing_time']);

      // Routing stats parsing
      if (this.queryData[day]['routing_done']) {
        this.isRoutingDataAvailable = true;
        this.systemStateRoutingTime.labels.push(date);
        this.systemStateRoutingTime.datasets[0].data.push(this.queryData[day]['routing_time']);

        this.systemStateRoutingTypes.datasets[0].data[0] += parseInt(this.queryData[day]['routing_rail_total']);
        this.systemStateRoutingTypes.datasets[0].data[1] += parseInt(this.queryData[day]['routing_road_total']);
        this.systemStateRoutingTypes.datasets[0].data[2] += parseInt(this.queryData[day]['routing_tram_total']);

        let success = 0;
        let fail = 0;
        success += parseInt(this.queryData[day]['routing_rail_success']) + parseInt(this.queryData[day]['routing_road_success']) +
          parseInt(this.queryData[day]['routing_tram_success']);

        fail += (parseInt(this.queryData[day]['routing_rail_total']) - parseInt(this.queryData[day]['routing_rail_success'])) +
          (parseInt(this.queryData[day]['routing_road_total']) - parseInt(this.queryData[day]['routing_road_success'])) +
          (parseInt(this.queryData[day]['routing_tram_total']) - parseInt(this.queryData[day]['routing_tram_success']));

        this.systemStateRoutingSuccess.datasets[0].data[0] += success;
        this.systemStateRoutingSuccess.datasets[0].data[1] += fail;
      }

      // Data processing times
      this.processingTimes.labels.push(date);
      this.processingTimes.datasets[0].data.push(this.queryData[day]['downloading_time']);
      this.processingTimes.datasets[1].data.push(this.queryData[day]['parsing_time']);
      this.processingTimes.datasets[2].data.push(this.queryData[day]['processing_time']);

      // Data processing
      this.processingDataAll.datasets[0].data[0] += parseInt(this.queryData[day]['stored_records']);
      this.processingDataAll.datasets[0].data[1] += (parseInt(this.queryData[day]['downloaded_records']) - parseInt(this.queryData[day]['stored_records']));
      this.processingDataDownload.labels.push(date);
      this.processingDataDownload.datasets[0].data.push(this.queryData[day]['downloaded_records']);
      this.processingDataSaved.labels.push(date);
      this.processingDataSaved.datasets[0].data.push(this.queryData[day]['stored_records']);
      this.processingTripsPlanned.labels.push(date);
      this.processingTripsPlanned.datasets[0].data.push(this.queryData[day]['trips_to_process']);
      this.processingTripsExtra.labels.push(date);
      this.processingTripsExtra.datasets[0].data.push(this.queryData[day]['data_without_trips']);
      if ((parseInt(this.queryData[day]['trips_to_process']) - parseInt(this.queryData[day]['trips_without_data'])) !== 0) {
        this.processingTripsAll.datasets[0].data[0] += (parseInt(this.queryData[day]['trips_to_process']) - parseInt(this.queryData[day]['trips_without_data']));
        this.processingTripsAll.datasets[0].data[1] += (parseInt(this.queryData[day]['trips_without_data']) + parseInt(this.queryData[day]['data_without_trips']));
      }
    }

    this.systemStateProcessingTime.labels.push('');
    this.systemStateProcessingTime.datasets[0].data.push(null);
    this.systemStateRoutingTime.labels.push('');
    this.systemStateRoutingTime.datasets[0].data.push(null);
    this.processingTimes.labels.push('');
    this.processingTimes.datasets[0].data.push(null);
    this.processingTimes.datasets[1].data.push(null);
    this.processingTimes.datasets[2].data.push(null);
  }
}