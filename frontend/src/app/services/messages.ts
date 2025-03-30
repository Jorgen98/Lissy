/*
 * UI messages service
 */

import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})

export class UIMessagesService {
    constructor(
        private toastMessageService: MessageService,
        private translate: TranslateService
    ) {}

    public loadingElemVisibility = new Subject<boolean>();
    public actualLoadingPercentage = new Subject<number>();

    public isLoadingEnabled = false;

    // Loading screen handling
    turnOnLoadingScreen() {
        this.actualLoadingPercentage.next(0);
        this.loadingElemVisibility.next(true);
        this.isLoadingEnabled = true;
    }

    turnOnLoadingScreenWithoutPercentage() {
        this.actualLoadingPercentage.next(NaN);
        this.loadingElemVisibility.next(true);
    }

    turnOffLoadingScreen() {
        this.loadingElemVisibility.next(false);
        this.isLoadingEnabled = false;
    }

    // Toast messages
    showMessage(type: 'info' | 'warning' | 'error', header: string, body: string) {
        switch (type) {
            case 'info': this.toastMessageService.add({ severity: 'info', summary: this.translate.instant(header), detail: this.translate.instant(body), life: 5000}); break;
            case 'warning': this.toastMessageService.add({ severity: 'warn', summary: this.translate.instant(header), detail: this.translate.instant(body), life: 10000 }); break;
            case 'error': this.toastMessageService.add({ severity: 'error', summary: this.translate.instant(header), detail: this.translate.instant(body), life: 600000}); break;
        }
    }
}