import { Component } from '@angular/core';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';

@Component({
    selector: 'app-planner',
    imports: [],
    templateUrl: './planner.component.html',
    styleUrl: './planner.component.css',
})
export class PlannerModule {
    static modulConfig: ModuleConfig = config;
}
