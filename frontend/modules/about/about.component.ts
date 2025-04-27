import { Component } from '@angular/core';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { TranslateService } from '@ngx-translate/core';
import { ImportsModule } from '../../src/app/imports';

@Component({
    selector: 'about',
    imports: [ImportsModule],
    templateUrl: './about.component.html',
    styleUrl: './about.component.css'
})

export class AboutModule {
    static modulConfig: ModuleConfig = config;
    public config: ModuleConfig = config;
    constructor(
        public translate: TranslateService
    ) {}

    public context: number = 0;

    public moduleFocus: Number = 0;

    public goToLink(url: string){
        window.open(url, "_blank");
    }

    // Show option menu on mobile devices
    public switchMobileSubMenuVisibility() {
        if (this.moduleFocus !== -1) {
            this.moduleFocus = -1;
        } else {
            this.moduleFocus = 0;
        }
    }
}