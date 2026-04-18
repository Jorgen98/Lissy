import { Component, effect, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';

@Component({
    selector: 'day-of-week-selector',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="day-of-week-selector-container">
            @for (day of daysOfWeek; track $index) {
                <span class="day-of-week-selector"
                [class.day-of-week-selector-selected]="selectedDay == day.idx"
                [class.day-of-week-selector-today]="todayIdx == day.idx"
                (click)="onRouteClick(day.idx)">
                    {{ day.label }}
                </span>
            }
        </div>
    `
})
export class DayOfWeekSelector {
    inputDayIdx = input<number>();
    daySelected = output<number>();

    daysOfWeek: { idx: number, label: string}[] = [];
    selectedDay: number = 1;
    todayIdx = (new Date()).getDay();

    constructor (
        public translate: TranslateService
    ) {
        this.translate.onLangChange.subscribe(() => {
            this.setDays();
        });

        this.setDays();

        effect(() => {
            this.selectedDay = this.inputDayIdx() ?? (new Date()).getDay();
        });
    }

    private setDays() {
        this.translate.get('primeng.dayNames').subscribe((days: string[]) => {
            this.daysOfWeek = days.map((day, idx) => {
                return { idx: idx, label: day}
            })
        });

        this.daysOfWeek.push(this.daysOfWeek.splice(0, 1)[0]);
    }

    public onRouteClick(dayToSelect: number) {
        this.selectedDay = dayToSelect;
        this.daySelected.emit(this.selectedDay);
    }
}
