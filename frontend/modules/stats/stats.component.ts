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
  public dates: Date[] = [new Date()];

  private async apiGet(url: string) {
    return await this.apiService.genericGet(`${config.apiPrefix}/${url}`);
  }

  public async ngOnInit() {
    this.renderData();
  }

  public setToday() {
    this.dates = [new Date()];
  }

  public renderData() {
    this.isCalendarModuleActive = false;
  }
}