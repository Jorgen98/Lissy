import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { CalendarModule } from 'primeng/calendar';
import { ChartModule } from 'primeng/chart';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessagesModule } from 'primeng/messages';
import { ToastModule } from 'primeng/toast';
import { SelectButtonModule } from 'primeng/selectbutton';
import { CheckboxModule } from 'primeng/checkbox';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';

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
    CalendarModule,
    ChartModule,
    ProgressSpinnerModule,
    MessagesModule,
    ToastModule,
    SelectButtonModule,
    CheckboxModule,
    FontAwesomeModule
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
    CalendarModule,
    ChartModule,
    ProgressSpinnerModule,
    MessagesModule,
    ToastModule,
    SelectButtonModule,
    CheckboxModule,
    FontAwesomeModule
  ]
})
export class ImportsModule {}
