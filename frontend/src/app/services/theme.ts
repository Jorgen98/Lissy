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

    // Whether the theme is currently dark
    private isDark = new BehaviorSubject<boolean>(true);

    // Same as above, turned into an observable that can be subscribed to 
    public isDark$ = this.isDark.asObservable();

    // Function to toggle the theme to the opposite value
    public toggle() {
        this.isDark.next(!this.isDark.value);
    }

    // Function setting the value of the isDark Subject
    public setIsDark(value: boolean) {
        this.isDark.next(value);
    }
}
