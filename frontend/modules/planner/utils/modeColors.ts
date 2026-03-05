/*
 * File: modeColors.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 * 
 * Key-value dictionary with hardcoded colors used for each mode in case they arent provided from somewhere else.
 */

import { Mode } from "../types/Mode"

// Color used for modes that wont appear for IDS JMK 
const DEFAULT_MODE_COLOR = "#777777"; 

// Each mode has its own hardcoded color or uses the default color
// The default color can simply be changed to something unique for a given mode if that mode should eventually be used in planning
export const modeColors: Record<Mode, string> = {
    CAR: "#FF0000",
    WALK: "#0000FF",
    BUS: "#FFFF00",
    RAIL: "#00FF00",
    TROLLEYBUS: "#AA00DD",
    TRAM: "#990000",
    FERRY: "#2299FF",
    AIRPLANE: DEFAULT_MODE_COLOR,
    CABLE_CAR: DEFAULT_MODE_COLOR,
    CARPOOL: DEFAULT_MODE_COLOR,
    COACH: DEFAULT_MODE_COLOR,
    FUNICULAR: DEFAULT_MODE_COLOR,
    GONDOLA: DEFAULT_MODE_COLOR,
    MONORAIL: DEFAULT_MODE_COLOR,
    SUBWAY: DEFAULT_MODE_COLOR,
    TAXI: DEFAULT_MODE_COLOR,
}