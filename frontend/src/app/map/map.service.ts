/*
 * App Map
 * Public map service methods
 */

import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

// Map object to render
export interface mapObject {
    // Name of layer to which should be the object placed
    layerName: string,
    // Type of object
    type: "stop" | "route",
    // Focus map on object after render
    focus: boolean,
    // Object latitude and longitude
    latLng: {lat: number, lng: number}[],
    // Object layer, if palette, object get color by metadata.zone_id property
    color: "base" | "palette" | "provided",
    // Additional object props
    metadata: any,
    // Can be clicked
    interactive: boolean,
    // Get hoover after click
    hoover: boolean
};

// Map object layer
export interface mapLayer {
    // Layer name
    name: string,
    // Actual layer object
    layer: L.FeatureGroup | undefined,
    // Layer color palette for objects
    palette: {[id: string]: string},
    // Layer color legend header
    paletteItemName?: string
}

@Injectable({
  providedIn: 'root'
})
export class MapService {  
    constructor() {}
    
    // Add new map layer
    public addNewLayerObj = new Subject<any>();
    addNewLayer(newLayer: mapLayer) {
        this.addNewLayerObj.next(newLayer);
    }

    // Add new object to layer
    public addToLayerObj = new BehaviorSubject<any>(null);
    addToLayer(object: mapObject) {
        this.addToLayerObj.next(object);
    }

    // Remove layer from map
    public removeLayerObj = new BehaviorSubject<any>(null);
    removeLayer(layerName: string) {
        this.removeLayerObj.next(layerName);
    }

    // Remove all objects from map layer
    public clearLayerObj = new BehaviorSubject<any>(null);
    clearLayer(layerName: string) {
        this.clearLayerObj.next(layerName);
    }

    public zoomInObj = new BehaviorSubject<any>(null);
    zoomIn() {
        this.zoomInObj.next(true);
    }

    public zoomOutObj = new BehaviorSubject<any>(null);
    zoomOut() {
        this.zoomOutObj.next(true);
    }

    // Fit map view to objects on map layer
    public fitToLayerObj = new BehaviorSubject<any>(null);
    fitToLayer(layerName: string) {
        this.fitToLayerObj.next(layerName);
    }
}