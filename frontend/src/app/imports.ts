import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Toast } from 'primeng/toast';
import { SelectButton } from 'primeng/selectbutton';
import { Checkbox } from 'primeng/checkbox';
import { ColorPicker } from 'primeng/colorpicker';
import { InputNumber } from 'primeng/inputnumber';
import { Tabs } from 'primeng/tabs';
import { DatePicker } from 'primeng/datepicker';
import { Select } from 'primeng/select';
import { Image } from 'primeng/image';
import { RouteSelector } from '../../components/routeSelector';
import { TripSelector } from '../../components/tripSelector';
import { DayOfWeekSelector } from '../../components/dayOfWeekSelector';
import { Stepper, Step, StepList, StepPanels, StepPanel } from 'primeng/stepper';

@NgModule({
    imports: [
        RouterOutlet,
        TranslatePipe,
        RouterLink,
        ButtonModule,
        FormsModule,
        CommonModule,
        ChartModule,
        ProgressSpinner,
        Toast,
        SelectButton,
        Checkbox,
        ColorPicker,
        InputNumber,
        Tabs,
        DatePicker,
        Select,
        Step,
        Stepper,
        StepPanel,
        StepPanels,
        StepList,
        Image,
        RouteSelector,
        TripSelector,
        DayOfWeekSelector
    ],
    exports: [
        RouterOutlet,
        TranslatePipe,
        RouterLink,
        ButtonModule,
        FormsModule,
        CommonModule,
        ChartModule,
        ProgressSpinner,
        Toast,
        SelectButton,
        Checkbox,
        ColorPicker,
        InputNumber,
        Tabs,
        DatePicker,
        Select,
        Step,
        Stepper,
        StepPanel,
        StepPanels,
        StepList,
        Image,
        RouteSelector,
        TripSelector,
        DayOfWeekSelector
    ]
})
export class ImportsModule {}
