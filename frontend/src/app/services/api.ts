/*
 * API handling service
 */

import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { retry } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})

export class APIService {
    constructor(private httpClient: HttpClient) {}

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
                reject(false);
            });
        });
    }

    // Generic endpoint
    private query(url: string) {
        return this.httpClient.get(`${this.whoToAsk}${url}`, {headers: this.headers}).pipe(retry(3));
    }

    public genericGet(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.query(url).subscribe(response => {
                if (!response) {
                    resolve(false);
                } else {
                    resolve(response);
                }
            }, error => {
                reject(false);
            });
        });
    }
}