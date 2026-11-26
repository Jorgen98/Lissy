/*
 * File: theme.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Angular service class that centrally handles and holds the state of the theme of the application.
 * Only light and dark themes.
 */

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class ThemeService {

    // Name of item key for storing the latest theme in local storage
    private readonly LOCAL_STORAGE_ITEM_NAME = "lissyTheme";

    // Whether themes are currently in use by the shown module
    private useThemes = false;

    // Whether the theme is currently dark
    private isDark = new BehaviorSubject<boolean>(true);

    // Same as above, turned into an observable that can be subscribed to 
    public isDark$ = this.isDark.asObservable();

    // Prefered system color scheme
    private mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    // Getter, whether themes are enabled in the module
    get themesEnabled() {
        return this.useThemes;
    }

    // Getter, whether the theme is currently dark
    get isDarkTheme() {
        return this.isDark.value;
    }
    
    constructor() {

        // Start listening for system color scheme preference changes
        this.mediaQuery.addEventListener("change", (event) => {
            if (!this.useThemes)
                return;

            // Use system theme if not set in localstorage
            const currentStored = localStorage.getItem(this.LOCAL_STORAGE_ITEM_NAME);
            if (!currentStored)
                this.isDark.next(event.matches);
        });
    }

    // Initialization function, enabled usage of themes when called
    public init() {
        this.useThemes = true;

        // If the light theme is stored in local storage, initialize with light theme instead, otherwise default to dark
        const storageTheme = localStorage.getItem(this.LOCAL_STORAGE_ITEM_NAME) as "light" | "dark" | null;

        Promise.resolve().then(() => this.initApplyTheme(storageTheme));  // Postpone until angular change detection cycle completes
    }

    // Function setting the value of the isDark Subject
    public setTheme(value: "light" | "dark" | "system") {
        if (value === "system") {
            localStorage.removeItem(this.LOCAL_STORAGE_ITEM_NAME);
            this.isDark.next(this.mediaQuery.matches);
        }
        else {
            localStorage.setItem(this.LOCAL_STORAGE_ITEM_NAME, value);
            this.isDark.next(value === "dark");
        }
    }

    // Function reseting the theme service to default dark theme
    public setDefault() {
        this.useThemes = false;
        this.isDark.next(true);
    }

    // Function applying the selected theme in init() function
    private initApplyTheme(value: "light" | "dark" | null) {
        if (value === "light")
            this.isDark.next(false);
        else if (value === "dark")
            this.isDark.next(true);
        else 
            this.isDark.next(this.mediaQuery.matches)
    }
}
