import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import * as config from './config.json';
import { ModuleConfig } from '../../src/app/app.component';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';

// Module configs
import * as configAboutModule from '../about/config.json';
import * as configStatsModule from '../stats/config.json';
import * as configShapesModule from '../shapes/config.json';

@Component({
  selector: 'dashboard',
  standalone: true,
  imports: [ ImportsModule ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})

export class DashboardModule implements OnInit {
  static modulConfig: ModuleConfig = config;
  public config: ModuleConfig = config;
  constructor(
    private apiService: APIService,
    private translate: TranslateService
  ) {}

  public isDBConnected: boolean = false;
  public modules: ModuleConfig[] = [
    configAboutModule,
    configStatsModule,
    configShapesModule
  ]

  public async ngOnInit() {
    this.isDBConnected = await this.apiService.isConnected();
  }
}