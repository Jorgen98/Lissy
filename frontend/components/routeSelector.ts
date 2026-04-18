import { Component, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { routeFromDB } from './types';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'route-selector',
    standalone: true,
    imports: [CommonModule, TranslateModule],
    template: `
        @if (displayedRoutes.length > 0) {
            @for (type of displayedRoutes; track $index) {
                @if (type.length > 0) {
                    <div class="route-selector-container">
                        @for (route of type; track $index) {
                            <span class="route-selector-route"
                            [class.route-selector-route-selected]="actualSelectedRoute?.id == route.id"
                            [style.backgroundColor]="'#' + route.route_color"
                            [style.color]="'#' + route.route_text_color"
                            (click)="onRouteClick(route)">
                                {{ route.route_short_name }}
                            </span>
                        }
                    </div>
                }
            }
        } @else {
            <div>{{ 'common.noRoute' | translate }}</div>
        }
    `
})
export class RouteSelector {
    routes = input<routeFromDB[]>();
    selectedRoute = input<routeFromDB>();
    routeSelected = output<routeFromDB>();

    availableRoutes: routeFromDB[] = [];
    displayedRoutes: routeFromDB[][] = [];

    actualSelectedRoute: routeFromDB | undefined;

    constructor() {
        effect(() => {
            this.availableRoutes = this.routes() ?? [];
            const collator = new Intl.Collator(undefined, {
                numeric: true,
                sensitivity: "base"
            });

            if (this.availableRoutes.length < 1) {
                this.displayedRoutes = [];
                return;
            }

            this.availableRoutes = this.availableRoutes.sort((a, b) => collator.compare(a.route_short_name, b.route_short_name));
            this.displayedRoutes[0] = this.availableRoutes.filter((route) => { return route.route_type === 0 });
            this.displayedRoutes[1] = this.availableRoutes.filter((route) => { return route.route_type === 4 });
            this.displayedRoutes[2] = this.availableRoutes.filter((route) => { return route.route_type === 2 });
            this.displayedRoutes[3] = this.availableRoutes.filter((route) => { return route.route_type === 800 });
            this.displayedRoutes[4] = this.availableRoutes.filter((route) => { return route.route_type === 3 });
            this.displayedRoutes[5] = this.availableRoutes.filter((route) => { return route.route_type === 11 });

            this.actualSelectedRoute = this.selectedRoute() ?? this.availableRoutes[0];
        });
    }

    onRouteClick(routeToSelect: routeFromDB) {
        this.actualSelectedRoute = routeToSelect;
        this.routeSelected.emit(this.actualSelectedRoute);
    }
}
