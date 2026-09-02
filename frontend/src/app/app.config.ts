import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient, withXhr } from '@angular/common/http';
import { provideTranslateService } from "@ngx-translate/core";
import { provideTranslateHttpLoader, TranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideAnimations } from '@angular/platform-browser/animations';
import { MessageService } from 'primeng/api';
import Aura from '@primeuix/themes/aura';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

const httpLoaderFactory: (http: HttpClient) => TranslateHttpLoader = (http: HttpClient) =>
    new TranslateHttpLoader();

export const appConfig: ApplicationConfig = {
    providers: [
        provideZoneChangeDetection({ eventCoalescing: true }),
        provideRouter(routes),
        provideAnimations(),
        provideHttpClient(withXhr()),
        provideAnimationsAsync(),
        providePrimeNG({
            theme: {
                preset: Aura
            },
            license: environment.primeLicense
        }),
        MessageService,
        provideTranslateService(),
        provideHttpClient(withXhr()),
        provideTranslateService({
        lang: 'en',
        fallbackLang: 'en',
        loader: provideTranslateHttpLoader({
            prefix: './assets/i18n/',
            suffix: '.json'
        })
        })
    ]
};
