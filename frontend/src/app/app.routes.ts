import { Routes } from '@angular/router';
import { AboutModule } from '../../modules/about/about.component';
import { DashboardModule } from '../../modules/dashboard/dashboard.component';
import { StatsModule } from '../../modules/stats/stats.component';
import { ShapesModule } from '../../modules/shapes/shapes.component';
import { DelayTripsModule } from '../../modules/delay-trips/delay-trips.component';

export const routes: Routes = [
    { path: DashboardModule.modulConfig.apiPrefix, component: DashboardModule },
    { path: AboutModule.modulConfig.apiPrefix, component: AboutModule },
    { path: StatsModule.modulConfig.apiPrefix, component: StatsModule },
    { path: ShapesModule.modulConfig.apiPrefix, component: ShapesModule },
    { path: DelayTripsModule.modulConfig.apiPrefix, component: DelayTripsModule }
];
