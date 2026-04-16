import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ToastModule } from 'primeng/toast';
import { SelectButtonModule } from 'primeng/selectbutton';
import { CheckboxModule } from 'primeng/checkbox';
import { ColorPickerModule } from 'primeng/colorpicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { TabsModule } from 'primeng/tabs';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { StepperModule } from 'primeng/stepper';
import { ImageModule } from 'primeng/image';
import { RouteSelector } from '../../components/routeSelector';
import { TripSelector } from '../../components/tripSelector';

@NgModule({
    imports: [
        RouterOutlet,
        TranslateModule,
        RouterLink,
        ButtonModule,
        FormsModule,
        CommonModule,
        ChartModule,
        ProgressSpinnerModule,
        ToastModule,
        SelectButtonModule,
        CheckboxModule,
        ColorPickerModule,
        InputNumberModule,
        TabsModule,
        DatePickerModule,
        SelectModule,
        StepperModule,
        ImageModule,
        RouteSelector,
        TripSelector
    ],
    exports: [
        RouterOutlet,
        TranslateModule,
        RouterLink,
        ButtonModule,
        FormsModule,
        CommonModule,
        ChartModule,
        ProgressSpinnerModule,
        ToastModule,
        SelectButtonModule,
        CheckboxModule,
        ColorPickerModule,
        InputNumberModule,
        TabsModule,
        DatePickerModule,
        SelectModule,
        StepperModule,
        ImageModule,
        RouteSelector,
        TripSelector
    ]
})
export class ImportsModule {}
