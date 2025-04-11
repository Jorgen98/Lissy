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
    // Actual delay categories
    private delayCategories: delayCategory[] = [];

    // Public observable objects
    public showDelayCategories = new Subject<delayCategory[]>();
    public hideDelayCategories = new Subject<void>();

    constructor() {
        this.resetDelayCategories();
    }

    // Set up default categories
    public resetDelayCategories() {
        this.delayCategories = [
            {minValue: -Infinity, maxValue: 3, color: "#22c55e"},
            {minValue: 3, maxValue: 5, color: "#eab308"},
            {minValue: 5, maxValue: 10, color: "#ff3d32"},
            {minValue: 10, maxValue: Infinity, color: "#3b82f6"}
        ]
    }

    // Trigger for delay categories on map put event
    public putDelayCategoriesOnMap() {
        this.showDelayCategories.next(this.delayCategories);
    }

    // Trigger for delay categories remove from map event
    public removeDelayCategoriesFromMap() {
        this.hideDelayCategories.next();
    }

    // Return actual delay categories
    public getDelayCategories() {
        let categories = JSON.parse(JSON.stringify(this.delayCategories));
        categories[0].minValue = 0;
        return categories;
    }

    // Set delay category values on selected index
    public setDelayCategory(idx: number, category: delayCategory) {
        if (idx < 0 || idx > (this.delayCategories.length - 1)) {
            return;
        }

        if (category.minValue === null || category.minValue === undefined) {
            return;
        }

        // Color
        this.delayCategories[idx].color = category.color;

        // Minimal value
        if (idx !== 0) {
            this.delayCategories[idx - 1].maxValue = category.minValue;
            this.delayCategories[idx].minValue = category.minValue;
        }

        // Maximal value
        if (idx < (this.delayCategories.length - 1)) {
            this.delayCategories[idx + 1].minValue = category.maxValue;
        }

        this.delayCategories[0].minValue = -Infinity;
        this.delayCategories[this.delayCategories.length - 1].maxValue = Infinity;
    }

    // Remove selected delay category
    public removeDelayCategory(idx: number) {
        if (idx < 0 || idx > (this.delayCategories.length - 1)) {
            return;
        }

        if (this.delayCategories.length < 2) {
            return;
        }

        this.delayCategories.splice(idx, 1);

        if (idx !== 0) {
            this.delayCategories[idx - 1].maxValue = this.delayCategories[idx].minValue;
        }

        this.delayCategories[0].minValue = -Infinity;
        this.delayCategories[this.delayCategories.length - 1].maxValue = Infinity;
    }

    // Add new delay category
    public addNewDelayCategory() {
        if (this.delayCategories.length > 4) {
            return;
        }

        this.delayCategories.push({
            minValue: this.delayCategories[this.delayCategories.length - 1].minValue + 0.25,
            maxValue: Infinity,
            color: "#6b7280"
        })

        this.delayCategories[this.delayCategories.length - 2].maxValue = this.delayCategories[this.delayCategories.length - 2].minValue + 0.25;
    }

    // Get delay category based on provided value
    // Return special noData category, if provided value is undefined
    public getDelayCategoryByValue(value: number | undefined): delayCategory {
        if (value === undefined) {
            return {
                minValue: -Infinity,
                maxValue: Infinity,
                color: "#6b7280"
            }
        }

        for (const category of this.delayCategories) {
            if (value >= category.minValue && value < category.maxValue) {
                return category;
            }
        }

        return this.delayCategories[this.delayCategories.length - 1];
    }
}