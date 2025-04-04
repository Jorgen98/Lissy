import { Component, AfterViewInit } from '@angular/core';
import * as L from 'leaflet';
import { environment } from '../../environments/environment';
import { mapLayer, mapObject, MapService } from './map.service';
import { TranslateService } from '@ngx-translate/core';
import { NgFor } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { delayCategoriesService, delayCategory } from '../services/delayCategories';

@Component({
  selector: 'map',
  standalone: true,
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.css'],
  imports: [ NgFor ]
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

        const t = this;
        this.map.on('zoomend', function() {
            for (const layer in t.layers) {
                if (t.layers[layer].layer) {
                    t.layers[layer].layer.eachLayer(function(object) {
                        if (t.map) {
                            if (object instanceof L.Marker) {
                                let icon = object.getIcon();
                                icon.options.iconSize = [t.map.getZoom() * 1.35, t.map.getZoom() * 1.35];
                                object.setIcon(icon);
                            }
                        }
                    })
                }
            }
        })
    }

    constructor(
        private mapService: MapService,
        private translate: TranslateService,
        private sanitizer: DomSanitizer,
        private delayCategoriesService: delayCategoriesService
    ) {
        this.mapService.addNewLayerObj.subscribe((newLayer) => this.addNewLayer(newLayer));
        this.mapService.addToLayerObj.subscribe((object) => this.addToLayer(object));
        this.mapService.removeLayerObj.subscribe((layerName) => this.removeLayer(layerName));
        this.mapService.zoomInObj.subscribe(() => this.map?.zoomIn());
        this.mapService.zoomOutObj.subscribe(() => this.map?.zoomOut());
        this.mapService.fitToLayerObj.subscribe((layerName) => this.fitToLayer(layerName));

        this.delayCategoriesService.showDelayCategories.subscribe((categories) => {
            this.actualizeDelayCategories(categories);
        })
        this.delayCategoriesService.hideDelayCategories.subscribe(() => {
            this.actualizeDelayCategories([]);
        })
    }

    ngAfterViewInit(): void {
        this.initMap();

        this.translate.onLangChange.subscribe(() => {
            this.actualizeColorLegend();
        });
    }

    private createStopIcon(object: mapObject) {
        if (!this.map) {
            return undefined;
        }

        let objectLayer = this.layers[object?.layerName];
        let objectClass = 'color-base';
        if (object.color === 'palette') {
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

    private createPolyline(object: mapObject) {
        if (!this.map) {
            return undefined;
        }

        let objectLayer = this.layers[object?.layerName];
        let objectClass = 'stop-icon-base';
        if (object.color === 'palette') {
            if (objectLayer.palette[object.metadata.route_id] === undefined) {
                let newColorIdx = Object.keys(objectLayer.palette).length % this.colorPaletteLength;
                objectLayer.palette[object.metadata.route_id] = this.colorPalette[newColorIdx];
                this.actualizeColorLegend();
            }
            objectClass = objectLayer.palette[object.metadata.route_id];
        }

        if (object.color === 'provided' && object.metadata.color === '#000000') {
            object.metadata.color = '#FFFFFF';
        }

        return L.polyline(
            object.latLng,
            { 
                color: object.color === 'provided' ? `${object.metadata.color}` : '000000',
                className: object.color === 'provided' ? '': objectClass
            }
        )
    }

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

        this.legendData = this.sanitizer.sanitize(1, legendLines.join(''));
    }

    private actualizeDelayCategories(categories: delayCategory[]) {
        let legend: String[] = [];
        let graphColors: String[] = [];
        let graphText: String[] = [];
        let graphTextGrid = categories.length > 1 ? `3.75em repeat(${categories.length - 1}, 6.25em) 3.75em` : "5em 5em";

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
            <span class="delay-categories-graph-legend-inner-text">Ostatní</span>
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

        this.delayLegendData = this.sanitizer.bypassSecurityTrustHtml(`<div class="legend-layer-div">${legend.join('')}</div>`);
    }

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

    private addToLayer(object: mapObject) {
        if (this.layers[object?.layerName] === undefined || this.map === undefined ||
            !this.layers[object.layerName].layer) {
            return;
        }

        let bounds: L.LatLngBoundsExpression = this.map.getBounds();

        switch (object.type) {
            case 'route': {
                let line = this.createPolyline(object);
                if (line) {
                    let lineOnMap = line.addTo(this.layers[object.layerName].layer!);
                    bounds = lineOnMap.getBounds();
                }
                break;
            }
            case 'stop': {
                L.marker(
                    L.latLng(object.latLng[0]),
                    {icon: this.createStopIconShadow()}
                )
                .addTo(this.layers[object.layerName].layer!);
                L.marker(
                    L.latLng(object.latLng[0]),
                    {icon: this.createStopIcon(object)}
                )
                .bindTooltip(`<b>${object.metadata.stop_name}</b>`)
                .addTo(this.layers[object.layerName].layer!);
                bounds = L.latLngBounds(L.latLng(object.latLng[0]), L.latLng(object.latLng[0]));
                break;
            }
        }

        if (object.focus) {
            this.map.fitBounds(bounds);
        }
    }

    private removeLayer(layerName: string) {
        let layerToRemove = this.layers[layerName];

        if (layerToRemove !== undefined && layerToRemove.layer) {
            this.map?.removeLayer(layerToRemove.layer);
            delete this.layers[layerName];
            this.actualizeColorLegend();
        }
    }

    private fitToLayer(name: string) {
        let layer = this.layers[name];

        if (layer !== undefined && layer.layer) {
            this.map?.fitBounds(layer.layer.getBounds());
        }
    }
}