import { Component, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { routeFromDB } from './types';

@Component({
    selector: 'route-selector',
    standalone: true,
    imports: [CommonModule],
    template: `
        @for (type of displayedRoutes; track $index) {
            @if (type.length > 0) {
                <div class="route-selector-container">
                    @for (route of type; track $index) {
                        <span class="route-selector-route"
                        [class.route-selector-route-selected]="selectedRoute?.id == route.id"
                        [style.backgroundColor]="'#' + route.route_color"
                        [style.color]="'#' + route.route_text_color"
                        (click)="onRouteClick(route)">
                            {{ route.route_short_name }}
                        </span>
                    }
                </div>
            }
        }
    `
})
export class RouteSelector {
    routes = input<routeFromDB[]>();
    routeSelected = output<routeFromDB>();

    availableRoutes: routeFromDB[] = [];
    displayedRoutes: routeFromDB[][] = Array(6);

    selectedRoute: routeFromDB | undefined;

    constructor() {
        effect(() => {
            this.availableRoutes = this.routes() ?? [];
            const collator = new Intl.Collator(undefined, {
                numeric: true,
                sensitivity: "base"
            });

            this.availableRoutes = this.availableRoutes.sort((a, b) => collator.compare(a.route_short_name, b.route_short_name));
            this.displayedRoutes[0] = this.availableRoutes.filter((route) => { return route.route_type === 0 });
            this.displayedRoutes[1] = this.availableRoutes.filter((route) => { return route.route_type === 4 });
            this.displayedRoutes[2] = this.availableRoutes.filter((route) => { return route.route_type === 2 });
            this.displayedRoutes[3] = this.availableRoutes.filter((route) => { return route.route_type === 800 });
            this.displayedRoutes[4] = this.availableRoutes.filter((route) => { return route.route_type === 3 });
            this.displayedRoutes[5] = this.availableRoutes.filter((route) => { return route.route_type === 11 });

            this.selectedRoute = this.availableRoutes[0];
        });
    }

    onRouteClick(routeToSelect: routeFromDB) {
        this.selectedRoute = routeToSelect;
        this.routeSelected.emit(this.selectedRoute);
    }
}
