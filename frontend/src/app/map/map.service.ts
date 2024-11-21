import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export interface mapObject {
    layerName: string,
    type: "stop" | "route",
    focus: boolean,
    latLng: {lat: number, lng: number}[],
    color: "base" | "palette" | "provided",
    metadata: any
};

export interface mapLayer {
    name: string,
    layer: L.FeatureGroup | undefined,
    palette: {[id: string]: string},
    paletteItemName?: string
}

@Injectable({
  providedIn: 'root'
})
export class MapService {  
    constructor() {}
    
    public addNewLayerObj = new Subject<any>();
    addNewLayer(newLayer: mapLayer) {
        this.addNewLayerObj.next(newLayer);
    }

    public addToLayerObj = new BehaviorSubject<any>(null);
    addToLayer(object: mapObject) {
        this.addToLayerObj.next(object);
    }

    public removeLayerObj = new BehaviorSubject<any>(null);
    removeLayer(layerName: string) {
        this.removeLayerObj.next(layerName);
    }

    public zoomInObj = new BehaviorSubject<any>(null);
    zoomIn() {
        this.zoomInObj.next(true);
    }

    public zoomOutObj = new BehaviorSubject<any>(null);
    zoomOut() {
        this.zoomOutObj.next(true);
    }

    public fitToLayerObj = new BehaviorSubject<any>(null);
    fitToLayer(layerName: string) {
        this.fitToLayerObj.next(layerName);
    }
}