import { Component } from '@angular/core';
import { ImportsModule } from './imports';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { UIMessagesService } from './services/messages';
import { PrimeNG } from 'primeng/config';

@Component({
    selector: 'app-root',
    imports: [ImportsModule],
    templateUrl: './app.component.html',
    styleUrl: './app.component.css'
})

export class AppComponent {
    public isDBConnected: boolean = false;

    public langs = [
        { code: 'cz', flag: 'GB' },
        { code: 'en', flag: 'CZ' }
    ];
    public selectedLang: {code: string, flag: string} = this.langs[0];

    public loadingElemVisibility = false;
    public loadingElemPercentage = '0%';

    constructor (
        private translate: TranslateService,
        public router: Router,
        private msgService: UIMessagesService,
        private primeng: PrimeNG
    ) {
        this.translate.addLangs(this.langs.map((lang) => {return lang.code}));
        this.translate.setDefaultLang(this.langs[0].code);

        // Set app language according to user cookies
        const savedLang = localStorage.getItem('userLang');
        if (savedLang !== null) {
            this.translate.use(this.langs[parseInt(savedLang)].code);
        } else {
            this.translate.use(this.langs[0].code);
        }

        this.translate.get('primeng').subscribe(res => this.primeng.setTranslation(res));

        router.events.subscribe(() => {msgService.turnOffLoadingScreen()});
        // Message service - loading events
        msgService.loadingElemVisibility.subscribe((visibility: boolean) => this.loadingElemVisibility = visibility);
        msgService.actualLoadingPercentage.subscribe((percentage: number) => {
            isNaN(percentage) ? this.loadingElemPercentage = '' : this.loadingElemPercentage = `${percentage}%`;
        });
    }

    public changeLang() {
        if (this.selectedLang.code === 'cz') {
            this.selectedLang = this.langs[1];
            localStorage.setItem('userLang', '1');
        } else {
            this.selectedLang = this.langs[0];
            localStorage.setItem('userLang', '0');
        }
        this.translate.use(this.selectedLang.code);
        this.translate.get('primeng').subscribe(res => this.primeng.setTranslation(res));
    }

    public goToLink(whereTo: string) {
        let url = '';
        if (whereTo === 'brno') {
            url = (this.selectedLang.code === 'en' ? 'https://datahub.brno.cz/' : 'https://data.brno.cz/');
        } else {
            url = (this.selectedLang.code === 'en' ? 'https://www.fit.vut.cz/.en' : 'https://www.fit.vut.cz/.cs');
        }
        window.open(url, "_blank");
    }
}

export interface ModuleConfig {
    enabled: boolean,
    apiPrefix: string,
    name: string,
    icon: string
}