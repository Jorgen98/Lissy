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

    // Query functions
    private queryIsAPIAlive() {
        return this.httpClient.get(this.whoToAsk, {headers: this.headers}).pipe(retry(3));
    }

    // Is DB connected to frontend?
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
}