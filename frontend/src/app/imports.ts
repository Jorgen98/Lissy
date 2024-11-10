import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { CalendarModule } from 'primeng/calendar';

@NgModule({
  imports: [
    RouterOutlet,
    TranslateModule,
    RouterLink,
    ButtonModule,
    DropdownModule,
    FormsModule,
    CommonModule,
    MarkdownModule,
    CalendarModule
  ],
  exports: [
    RouterOutlet,
    TranslateModule,
    RouterLink,
    ButtonModule,
    DropdownModule,
    FormsModule,
    CommonModule,
    MarkdownModule,
    CalendarModule
  ],
  providers: []
})
export class ImportsModule {}
