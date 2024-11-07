import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})

export class AppComponent {
  public isDBConnected: boolean = false;
  
  constructor() {}
}

export interface ModuleConfig {
  enabled: boolean,
  apiPrefix: string,
  name: string
}