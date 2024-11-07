import { Component, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { APIService } from '../../src/app/services/api';
import * as config from './config.json';
import { ModuleConfig } from '../../src/app/app.component';
import { CommonModule } from '@angular/common';

// Module configs
import * as configAboutModule from '../about/config.json';
import * as configStatsModule from '../stats/config.json';

@Component({
  selector: 'dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})

export class DashboardModule implements OnInit {
  static modulConfig: ModuleConfig = config;
  public config: ModuleConfig = config;
  constructor(private apiService: APIService, private router: Router) {}

  public isDBConnected: boolean = false;
  public modules: ModuleConfig[] = [
    configAboutModule,
    configStatsModule
  ]

  public async ngOnInit() {
    this.isDBConnected = await this.apiService.isConnected();
  }
}