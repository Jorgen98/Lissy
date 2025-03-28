/*
 * API handling service
 */

import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { retry } from 'rxjs';
import { environment } from '../../environments/environment';
import { UIMessagesService } from './messages';

@Injectable({
    providedIn: 'root'
})

export class APIService {
    constructor(
        private httpClient: HttpClient,
        private UIMessageService: UIMessagesService
    ) {}

    private whoToAsk = environment.apiUrl;
    private headers = new HttpHeaders().set('Authorization', environment.apiKey);

    // Is DB connected to frontend?
    private queryIsAPIAlive() {
        return this.httpClient.get(this.whoToAsk, {headers: this.headers}).pipe(retry(3));
    }

    public isConnected(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.queryIsAPIAlive().subscribe(response => {
                if (response) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            }, error => {
                resolve(false);
            });
        });
    }

    // Generic endpoint
    private query(url: string, params?: {[name: string]: string}) {
        if (params) {
            let queryText = `${this.whoToAsk}${url}?`;

            for (const [idx, param] of Object.keys(params).entries()) {
                if (params[param] === 'true') {
                    queryText += `${param}=true`;
                } else if (params[param] === 'false') {
                    queryText += `${param}=false`;
                } else {
                    queryText += `${param}=${params[param]}`;
                }
                if (idx < (Object.keys(params).length - 1)) {
                    queryText += '&';
                }
            }

            if (this.UIMessageService.isLoadingEnabled) {

            }

            return this.httpClient.get(queryText, {headers: this.headers}).pipe(retry(3));
        } else {
            return this.httpClient.get(`${this.whoToAsk}${url}`, {headers: this.headers}).pipe(retry(3));
        }
    }

    public genericGet(url: string, params?: {[name: string]: string}): Promise<any> {
        return new Promise((resolve, reject) => {
            this.query(url, params).subscribe(response => {
                if (!response) {
                    resolve(false);
                } else {
                    if (this.UIMessageService.isLoadingEnabled) {
                        if (response.hasOwnProperty('progress')) {
                            let t = this;
                            setTimeout(async function(){
                                resolve(await t.genericGet(url, params));
                            }, 2000);
                        } else {
                            resolve(response);
                        }
                    } else {
                        resolve(response);
                    }
                }
            }, error => {
                reject(false);
            });
        });
    }
}