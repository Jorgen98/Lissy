import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { APIService } from './services/api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  public isDBConnected: boolean = false;
  
  constructor(private apiService: APIService) {}

  public async ngOnInit() {
    this.isDBConnected = await this.apiService.isConnected();
  }
}
