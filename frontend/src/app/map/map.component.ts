/*
 * App Map
 * Map manipulation functions
 */

import { Component, AfterViewInit } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../../environments/environment';
import { mapLayer, mapObject, MapService } from './map.service';
import { TranslateService } from '@ngx-translate/core';
import { NgIf } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { delayCategoriesService, delayCategory } from '../services/delayCategories';

@Component({
    selector: 'map',
    templateUrl: './map.component.html',
    styleUrls: ['./map.component.css'],
    imports: [ NgIf ]
})
export class MapComponent implements AfterViewInit {
    private map: L.Map | undefined = undefined;
    private layers: {[name: string]: mapLayer} = {};
    private colorPalette: {[id: number]: string} = {
        0: 'color-a',
        1: 'color-b',
        2: 'color-c',
        3: 'color-d'
    };
    private colorPaletteLength = Object.keys(this.colorPalette).length;
    public actualLegend: String[] = [];
    public legendData: String | null = '';
    public delayLegendData: any = '';

    public enableLegend: boolean = false;
    public enableDelayCategories: boolean = false;

    // Init map
    private initMap(): void {
        const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 20,
            minZoom: 7
        });

        this.map = L.map('map', {
            center: JSON.parse(environment.mapCenter),
            zoom: JSON.parse(environment.mapZoom),
            layers: [tiles],
            zoomControl: false
        });

        // Change stop icon size according to actual map zoom
        const t = this;
        this.map.on('zoomend', function() {
            for (const layer in t.layers) {
                if (t.layers[layer].layer) {
                    t.layers[layer].layer.eachLayer(function(object) {
                        if (t.map) {
                            if (object instanceof L.Marker) {
                                let icon = object.getIcon();
                                if (icon.options.className !== 'color-base-shadow') {
                                    icon.options.iconSize = [t.map.getZoom() * 1.35, t.map.getZoom() * 1.35];
                                } else {
                                    icon.options.iconSize = [t.map.getZoom() * 2, t.map.getZoom() * 2];
                                }
                                object.setIcon(icon);
                            }
                        }
                    })
                }
            }
        })

        this.map.on('click', () => { this.mapService.clearLayerObj.next('hoover')});
    }

    constructor(
        public mapService: MapService,
        private translate: TranslateService,
        private sanitizer: DomSanitizer,
        private delayCategoriesService: delayCategoriesService
    ) {
        this.mapService.addNewLayerObj.subscribe((newLayer) => this.addNewLayer(newLayer));
        this.mapService.addToLayerObj.subscribe((object) => this.addToLayer(object));
        this.mapService.removeLayerObj.subscribe((layerName) => this.removeLayer(layerName));
        this.mapService.clearLayerObj.subscribe((layerName) => this.clearLayer(layerName));
        this.mapService.zoomInObj.subscribe(() => this.map?.zoomIn());
        this.mapService.zoomOutObj.subscribe(() => this.map?.zoomOut());
        this.mapService.fitToLayerObj.subscribe((layerName) => this.fitToLayer(layerName));

        this.delayCategoriesService.showDelayCategories.subscribe((categories) => {
            this.actualizeDelayCategories(categories);
        })
        this.delayCategoriesService.hideDelayCategories.subscribe(() => {
            this.actualizeDelayCategories([]);
            this.enableDelayCategories = false;
        })
    }

    ngAfterViewInit(): void {
        this.initMap();

        this.mapService.addNewLayer({name: 'hoover', palette: {}, layer: undefined, paletteItemName: ''});

        this.translate.onLangChange.subscribe(() => {
            this.actualizeColorLegend();
        });
    }

    // Create stop icon object
    private createStopIcon(object: mapObject) {
        if (!this.map) {
            return undefined;
        }

        let objectLayer = this.layers[object?.layerName];
        let objectClass = 'color-base';
        if (object.color === 'palette') {
            // If object color is in palette mode, get color from layer palette
            if (objectLayer.palette[object.metadata.zone_id] === undefined) {
                let newColorIdx = Object.keys(objectLayer.palette).length % this.colorPaletteLength;
                objectLayer.palette[object.metadata.zone_id] = this.colorPalette[newColorIdx];
                this.actualizeColorLegend();
            }
            objectClass = objectLayer.palette[object.metadata.zone_id];
        }

        return L.icon({
            iconUrl: object.metadata.wheelchair_boarding === 1 ? 'icons/stop-wheelchair.svg' : 'icons/stop.svg',
            iconSize: [this.map.getZoom() * 1.35, this.map.getZoom() * 1.35],
            className: objectClass
        });
    }

    // Creates stop svg icon shadow
    private createStopIconShadow() {
        if (!this.map) {
            return undefined;
        }

        return L.icon({
            iconUrl: 'icons/stop.svg',
            iconSize: [this.map.getZoom() * 1.35, this.map.getZoom() * 1.35],
            className: "color-background"
        });
    }

    // Creates stop svg icon hoover
    private createStopIconHoover() {
        if (!this.map) {
            return undefined;
        }

        return L.icon({
            iconUrl: 'icons/stop.svg',
            iconSize: [this.map.getZoom() * 2, this.map.getZoom() * 2],
            className: "color-base-shadow"
        });
    }

    // Create polyline object
    private createPolyline(object: mapObject) {
        if (!this.map) {
            return undefined;
        }

        if (object.color === 'provided' && object.metadata.color === '#000000') {
            object.metadata.color = '#FFFFFF';
        }

        return L.polyline(
            object.latLng,
            { 
                color: object.color === 'provided' ? `${object.metadata.color}` : '#FFFFFF',
                weight: 5,
                interactive: object.interactive
            }
        )
    }

    // Create polyline object hoover
    private createPolylineShadow(object: mapObject) {
        if (!this.map) {
            return undefined;
        }

        return L.polyline(
            object.latLng,
            { 
                color: '#FFFFFF',
                weight: 12,
                interactive: false,
                opacity: 0.4,
                pane: "tilePane"
            }
        )
    }

    // Render color legend for every layer
    private actualizeColorLegend() {
        let legendLines: String[] = [];
        for (const layer in this.layers) {
            let layerColors: String[] = [];
            if (this.layers[layer].paletteItemName) {
                let palette = this.layers[layer].palette;
                for (const color in palette) {
                    layerColors.push(`
                        <div class="legend-item">
                            <img class="legend-img ${palette[color]}" src="./icons/stop.svg"/>
                            <span class="legend-text">${this.translate.instant(this.layers[layer].paletteItemName)} ${color}</span>
                        </div>
                    `)
                }
            }

            if (layerColors.length > 0) {
                legendLines.push(`
                    <div class="legend-layer-div">${layerColors.join('')}</div>
                `)
            }
        }

        if (legendLines.length > 0) {
            this.legendData = this.sanitizer.sanitize(1, legendLines.join(''));
            this.enableLegend = true;
        } else {
            this.enableLegend = false;
        }
    }

    // Render delay categories legend
    private actualizeDelayCategories(categories: delayCategory[]) {
        let legend: String[] = [];
        let graphColors: String[] = [];
        let graphText: String[] = [];
        let graphTextGrid = categories.length > 1 ? `3.75em repeat(${categories.length - 1}, 6.25em) 3.75em` : "5em 5em";

        if (categories.length < 1) {
            this.enableDelayCategories = false;
            return;
        }

        for (const category of categories) {
            graphColors.push(`
                <span class="delay-categories-graph-color" style="background-color: ${category.color}"></span>
            `)
        }
        graphText.push(`
            <span class="delay-categories-graph-legend-inner-text">0 min.</span>
        `)
        for (let idx = 1; idx < categories.length; idx++) {
            graphText.push(`
                <span class="delay-categories-graph-legend-inner-text">${categories[idx].minValue} min.</span>
            `)
        }
        graphText.push(`
            <span class="delay-categories-graph-legend-inner-text">${this.translate.instant("delay.other")}</span>
        `)
        let graphFills = Array(categories.length - 1).fill(`
            <span class="delay-categories-graph-color delay-categories-graph-legend-fill"></span>
            <span class="delay-categories-graph-legend-point"></span>`
        );

        legend.push(`
            <div class="delay-categories-main-div">
                <span>Zpoždění</span>
                <span class="delay-categories-graph-main">
                    <div class="delay-categories-graph-outer">
                        <span class="delay-categories-graph-frame">
                            ${graphColors.join('')}
                        </span>
                    </div>
                    <div class="delay-categories-graph-legend-outer">
                        <span class="delay-categories-graph-legend-point"></span>
                        <span class="delay-categories-graph-color delay-categories-graph-legend-fill"></span>
                        <span class="delay-categories-graph-legend-point"></span>
                        ${graphFills.join('')}
                    </div>
                </span>
                <div class="delay-categories-graph-legend-text" style="grid-template-columns: ${graphTextGrid}">
                    ${graphText.join('')}
                </div>
            </div>
        `)

        if (graphColors.length > 0) {
            this.enableDelayCategories = true;
            this.delayLegendData = this.sanitizer.bypassSecurityTrustHtml(`<div class="legend-layer-div">${legend.join('')}</div>`);
        } else {
            this.enableDelayCategories = false;
        }
    }

    // Adds new object layer to map
    private addNewLayer(newLayer: mapLayer) {
        if (this.layers[newLayer.name] === undefined) {
            let newLayerGroup = L.featureGroup();
            this.layers[newLayer.name] = {
                name: newLayer.name,
                layer: newLayerGroup,
                palette: {},
                paletteItemName: newLayer.paletteItemName
            };
            this.map?.addLayer(newLayerGroup);
        }
    }

    // Add new object to map layer
    private addToLayer(object: mapObject) {
        if (this.layers[object?.layerName] === undefined || this.map === undefined ||
            !this.layers[object.layerName].layer) {
            return;
        }

        let bounds: L.LatLngBoundsExpression = this.map.getBounds();

        switch (object.type) {
            // Polyline
            case 'route': {
                let line = this.createPolyline(object);
                if (line) {
                    let lineOnMap = line.addTo(this.layers[object.layerName].layer!);
                    if (object.metadata.delay_value !== undefined) {
                        let labelHead = "";
                        // Count polyline delay value according to provided aggregation function
                        switch (object.metadata.agg_method) {
                            case 'avg': labelHead = this.translate.instant('map.avg'); break;
                            case 'sum': labelHead = this.translate.instant('map.sum'); break;
                            case 'max': labelHead = this.translate.instant('map.max'); break;
                            case 'min': labelHead = this.translate.instant('map.min'); break;
                        }
                        lineOnMap.on('click', (event: L.LeafletEvent) => {
                            L.popup()
                            .setLatLng(lineOnMap.getCenter())
                            .setContent(`
                                <span class="stop-content">
                                    ${object.metadata.route_name ? "<span class='stop-name'>" + object.metadata.route_name + "</span>": ""}
                                    ${"<span>" + labelHead + ": <b>" + object.metadata.delay_value + " min.</b></span>"}
                                </span>
                            `)
                            .addTo(this.layers[object.layerName].layer!)
                            .on('remove', () => {
                                this.mapService.clearLayerObj.next('hoover');
                            });

                            // On polyline click, if hoover is enabled
                            if (object.hoover) {
                                this.mapService.clearLayerObj.next('hoover');
                                let hooverLine = this.createPolylineShadow(object);
                                if (hooverLine) {
                                    hooverLine.addTo(this.layers['hoover'].layer!);
                                }
                            }

                            L.DomEvent.stopPropagation(event);
                        })
                    }

                    bounds = lineOnMap.getBounds();
                }
                break;
            }
            // Stop
            case 'stop': {
                let delayCategories = this.delayCategoriesService.getDelayCategories();
                let categoriesHtmlElem: any[] = [];
                let pieChartSegmentsHtmlElem: any[] = [];

                // Render stop arrival stats, if delays are provided
                if (object.metadata.delays) {
                    let delaysCount = 0;
                    for (let category of delayCategories) {
                        category.count = 0;
                    }

                    for (const delay of object.metadata.delays) {
                        let idx = this.delayCategoriesService.getDelayCategoryIdxByValue(delay);

                        if (idx !== -1) {
                            delayCategories[idx].count++;
                            delaysCount++;
                        }
                    }

                    // Prepare delay legend
                    let idx = 0;
                    let segmentMove = 0;
                    while (idx < delayCategories.length) {
                        if (delayCategories[idx].count === 0) {
                            delayCategories.splice(idx, 1);
                        } else {
                            delayCategories[idx].count = Math.floor((delayCategories[idx].count / (delaysCount * 1.0)) * 10000) / 100.0;
                            pieChartSegmentsHtmlElem.push(`
                                <circle r="5" cx="10" cy="10" fill="transparent" stroke="${delayCategories[idx].color}" stroke-width="10"
                                    stroke-dasharray="${delayCategories[idx].count * 0.314} 31.4" stroke-dashoffset="-${segmentMove}"/>
                            `);
                            segmentMove += delayCategories[idx].count * 0.314;
                            categoriesHtmlElem.push(`
                                <span class="delay-categories-stop-legend-row">
                                    <span class="delay-categories-stop-dot" style="background-color: ${delayCategories[idx].color};"></span>
                                    <b class="delay-categories-stop-text">${delayCategories[idx].count}%</b>
                                </span>
                            `);
                            idx++;
                        }
                    }
                }

                L.marker(
                    L.latLng(object.latLng[0]),
                    {
                        icon: this.createStopIconShadow(),
                        interactive: false
                    }
                )
                .addTo(this.layers[object.layerName].layer!);
                L.marker(
                    L.latLng(object.latLng[0]),
                    {
                        icon: this.createStopIcon(object),
                        interactive: object.interactive
                    }
                )
                .addTo(this.layers[object.layerName].layer!)
                // Render stop tooltip on click
                .on('click', () => {
                    L.popup()
                    .setLatLng(object.latLng[0])
                    .setContent(`
                        <span class="stop-content">
                            ${object.metadata.stop_name ? "<span class='stop-name'>" + object.metadata.stop_name + "</span>": ""}
                            ${object.metadata.zone_id ? "<span><b>" + this.translate.instant("map.zone") + ":</b> " + object.metadata.zone_id + "</span>": ""}
                            ${object.metadata.order ? "<span><b>" + this.translate.instant("map.order") + ":</b> " + object.metadata.order + "</span>": ""}
                            ${object.metadata.wheelchair_boarding === 1 ? "<span>" + this.translate.instant("map.wheelchair") + "</span>": ""}
                            ${object.metadata.delays ? "<span><b>" + this.translate.instant("map.delayStats") + "</b></span>": ""}
                            ${
                                object.metadata.delays && delayCategories.length > 0 ?
                                "<span class='delay-categories-stop-legend-main'>" +
                                    "<span class='delay-categories-stop-legend-inner'><svg height='6em' width='6em' viewBox='0 0 20 20'>" + pieChartSegmentsHtmlElem.join('') + "</svg></span>" +
                                    "<span class='delay-categories-stop-legend-inner'>" + categoriesHtmlElem.join('') + "</span>" +
                                "</span>":
                                object.metadata.delays ? "<span>" + this.translate.instant("map.delayStatsNoData") + "</span>" : ""
                            }
                        </span>
                    `)
                    .addTo(this.layers[object.layerName].layer!);
                    // Add stop hoover on click, if enabled
                    if (object.hoover) {
                        this.mapService.clearLayerObj.next('hoover');
                        L.marker(
                            L.latLng(object.latLng[0]),
                            {
                                icon: this.createStopIconHoover(),
                                interactive: false
                            }
                        )
                        .addTo(this.layers['hoover'].layer!);
                    }
                })
                bounds = L.latLngBounds(L.latLng(object.latLng[0]), L.latLng(object.latLng[0]));
                break;
            }
        }

        if (object.focus) {
            this.map.fitBounds(bounds);
        }
    }

    // Remove object layer from map
    private removeLayer(layerName: string) {
        let layerToRemove = this.layers[layerName];

        if (layerToRemove !== undefined && layerToRemove.layer) {
            this.map?.removeLayer(layerToRemove.layer);
            delete this.layers[layerName];
            this.actualizeColorLegend();
        }
    }

    // Remove all objects from layer
    private clearLayer(layerName: string) {
        let layerToRemove = this.layers[layerName];

        if (layerToRemove !== undefined && layerToRemove.layer) {
            layerToRemove.layer.clearLayers();
            this.actualizeColorLegend();
        }
    }

    // Fit map view to map layer according to actual layer objects
    private fitToLayer(name: string) {
        let layer = this.layers[name];

        if (layer !== undefined && layer.layer) {
            this.map?.fitBounds(layer.layer.getBounds());
        }
    }
}