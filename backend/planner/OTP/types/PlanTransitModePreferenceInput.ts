/*
 * File: PlanTransitModePreferenceInput.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type for possible transit modes in OTP planConnection.
 * Only uses train, bus, tram and trolleybus as transit modes, but can be extended by changing the Extract<> utility type.
 */

import { OTPMode } from "./OTPMode";

// Extract wanted modes from the general Mode union type with all modes (for IDS JMK)
export type PlanTransitModePreferenceInput = { mode: Extract<OTPMode, "RAIL" | "TROLLEYBUS" | "BUS" | "TRAM" | "FERRY"> };