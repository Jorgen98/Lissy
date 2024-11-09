import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';

@NgModule({
  imports: [
    RouterOutlet,
    TranslateModule,
    RouterLink,
    ButtonModule,
    DropdownModule,
    FormsModule,
    CommonModule,
    MarkdownModule
  ],
  exports: [
    RouterOutlet,
    TranslateModule,
    RouterLink,
    ButtonModule,
    DropdownModule,
    FormsModule,
    CommonModule,
    MarkdownModule
  ],
  providers: []
})
export class ImportsModule {}
