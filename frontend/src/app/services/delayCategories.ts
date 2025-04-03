/*
 * Delay categories service
 */

import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

// Delay category structure
export interface delayCategory {
    minValue: number;
    maxValue: number;
    color: string;
}

@Injectable({
    providedIn: 'root'
})

export class delayCategoriesService {
    // Set default delay categories
    private delayCategories: delayCategory[] = [
        {minValue: -Infinity, maxValue: 2, color: "#22c55e"},
        {minValue: 2, maxValue: 5, color: "#eab308"},
        {minValue: 5, maxValue: 10, color: "#ff3d32"},
        {minValue: 10, maxValue: Infinity, color: "#3b82f6"}
    ];

    public showDelayCategories = new Subject<delayCategory[]>();
    public hideDelayCategories = new Subject<void>();

    constructor() {}

    putDelayCategoriesOnMap() {
        this.showDelayCategories.next(this.delayCategories);
    }

    removeDelayCategoriesFromMap() {
        this.hideDelayCategories.next();
    }
}