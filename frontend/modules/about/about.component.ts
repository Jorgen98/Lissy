import { Component } from '@angular/core';
import { ModuleConfig } from '../../src/app/app.component';
import * as config from './config.json';
import { TranslateService } from '@ngx-translate/core';
import { ImportsModule } from '../../src/app/imports';

@Component({
  selector: 'about',
  standalone: true,
  imports: [ ImportsModule ],
  templateUrl: './about.component.html',
  styleUrl: './about.component.css'
})

export class AboutModule {
  static modulConfig: ModuleConfig = config;
  public config: ModuleConfig = config;
  constructor(
    public translate: TranslateService
  ) {}
}