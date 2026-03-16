/*
 * File: dashboard.component.ts
 * Author: Juraj Lazur (ilazur@fit.vut.cz)
 * Contributors: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Main class component for the dashboard module.
 */

import { Component, OnInit } from '@angular/core';
import { APIService } from '../../src/app/services/api';
import * as config from './config.json';
import { ModuleConfig } from '../../src/app/app.component';
import { ImportsModule } from '../../src/app/imports';
import { TranslateService } from '@ngx-translate/core';
import { faRoute } from '@fortawesome/free-solid-svg-icons';
import { faHourglassHalf } from '@fortawesome/free-solid-svg-icons';
import { faMapLocationDot } from '@fortawesome/free-solid-svg-icons';

// Module configs
import * as configAboutModule from '../about/config.json';
import * as configStatsModule from '../stats/config.json';
import * as configShapesModule from '../shapes/config.json';
import * as configDelayTripsModule from '../delay-trips/config.json';
import * as configPlannerModule from '../planner/config.json';

@Component({
    selector: 'dashboard',
    imports: [ImportsModule],
    templateUrl: './dashboard.component.html',
    styleUrl: './dashboard.component.css'
})

export class DashboardModule implements OnInit {
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;
    constructor(
        private apiService: APIService,
        public translate: TranslateService
    ) {}

    public faIconRoute = faRoute;
    public faIconHourglassHalf = faHourglassHalf;
    public faIconMapLocation = faMapLocationDot;

    public moduleFocus: Number = 0;

    public isDBConnected: boolean = false;
    public modules: ModuleConfig[] = [
        configAboutModule,
        configStatsModule,
        configShapesModule,
        configDelayTripsModule,
        configPlannerModule
    ]

    public async ngOnInit() {
        this.isDBConnected = await this.apiService.isConnected();
    }

    // Show language settings on mobile devices
    public switchMobileSubMenuVisibility() {
        if (this.moduleFocus !== -1) {
            this.moduleFocus = -1;
        } else {
            this.moduleFocus = 0;
        }
    }
}