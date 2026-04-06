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
    
    // Initialization function, enabled usage of themes when called
    public init() {
        this.useThemes = true;
    }

    // Function to toggle the theme to the opposite value
    public toggle() {
        this.isDark.next(!this.isDark.value);
    }

    // Function setting the value of the isDark Subject
    public setIsDark(value: boolean) {
        this.isDark.next(value);
    }

    // Function reseting the theme service to default dark theme
    public setDefault() {
        this.useThemes = false;
        this.isDark.next(true);
    }
}
