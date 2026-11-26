import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-page-not-found',
  templateUrl: './page-not-found.component.html',
  styleUrl: './page-not-found.component.css',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [ RouterLink, TranslatePipe ]
})

export class PageNotFoundComponent {
    constructor () {}
}
