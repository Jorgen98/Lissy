/*
 * File: PlanDirectMode.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Type for possible direct modes in OTP planConnection.
 * Only uses car and walking as direct modes, but can be extended by changing the Extract<> utility type.
 */

import { OTPMode } from "./OTPMode";

// Extract wanted modes from the general OTPMode union type with all modes
export type PlanDirectMode = Extract<OTPMode, "CAR" | "WALK">;