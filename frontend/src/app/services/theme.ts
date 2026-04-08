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
    private LOCAL_STORAGE_ITEM_NAME = "lissyTheme";

    // Whether themes are currently in use by the shown module
    private useThemes = false;

    // Whether the theme is currently dark
    private isDark = new BehaviorSubject<boolean>(true);

    // Same as above, turned into an observable that can be subscribed to 
    public isDark$ = this.isDark.asObservable();

    // Getter, whether themes are enabled in the module
    get themesEnabled() {
        return this.useThemes;
    }

    // Getter, whether the theme is currently dark
    get isDarkTheme() {
        return this.isDark.value;
    }
    
    // Initialization function, enabled usage of themes when called
    public init() {
        this.useThemes = true;

        // If the light theme is stored in local storage, initialize with light theme instead, otherwise default to dark
        const storageTheme = localStorage.getItem(this.LOCAL_STORAGE_ITEM_NAME);
        if (storageTheme === "light")
            Promise.resolve().then(() => this.isDark.next(false));  // Postpone until angular change detection cycle completes
    }

    // Function setting the value of the isDark Subject
    public setIsDark(value: boolean) {
        this.isDark.next(value);

        // Store the selected theme in local storage
        localStorage.setItem(this.LOCAL_STORAGE_ITEM_NAME, value ? "dark" : "light");
    }

    // Function reseting the theme service to default dark theme
    public setDefault() {
        this.useThemes = false;
        this.isDark.next(true);
    }
}
