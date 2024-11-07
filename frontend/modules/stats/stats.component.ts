import { Component, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { APIService } from '../../src/app/services/api';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'stats',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.css'
})

export class StatsModule implements OnInit {
  static modulConfig: ModuleConfig = config;
  public config: ModuleConfig = config;
  constructor(private apiService: APIService) {}

  public DBoutPut: string = '';

  private async apiGet(url: string) {
    return await this.apiService.genericGet(`${config.apiPrefix}/${url}`);
  }

  public async ngOnInit() {
    this.DBoutPut = JSON.stringify(await this.apiGet(''));
  }
}