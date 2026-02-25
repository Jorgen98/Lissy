/*
 * File: PlanTransitModePreferenceInput.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type for possible transit modes in OTP planConnection.
 * Only uses train, bus, tram and trolleybus as transit modes, but can be extended by changing the Extract<> utility type.
 */

import { Mode } from "./Mode";

// Extract wanted modes from the general Mode union type with all modes
export type PlanTransitModePreferenceInput = { mode: Extract<Mode, "RAIL" | "TROLLEYBUS" | "BUS" | "TRAM"> };