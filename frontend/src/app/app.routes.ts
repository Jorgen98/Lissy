/*
 * App routing file
 *
 * Authors: Juraj Lazur (ilazur@fit.vut.cz)
 * Contributors: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 */

import { Routes } from '@angular/router';
import { AboutModule } from '../../modules/about/about.component';
import { DashboardModule } from '../../modules/dashboard/dashboard.component';
import { StatsModule } from '../../modules/stats/stats.component';
import { ShapesModule } from '../../modules/shapes/shapes.component';
import { DelayTripsModule } from '../../modules/delay-trips/delay-trips.component';
import { PageNotFoundComponent } from './page-not-found/page-not-found.component';
import { PlannerModule } from '../../modules/planner/planner.component';

export const routes: Routes = [
    { path: DashboardModule.modulConfig.apiPrefix, component: DashboardModule },
    { path: AboutModule.modulConfig.apiPrefix, component: AboutModule },
    { path: StatsModule.modulConfig.apiPrefix, component: StatsModule },
    { path: ShapesModule.modulConfig.apiPrefix, component: ShapesModule },
    { path: DelayTripsModule.modulConfig.apiPrefix, component: DelayTripsModule },
    { path: PlannerModule.modulConfig.apiPrefix, component: PlannerModule },
    { path: '**', component: PageNotFoundComponent }
];
