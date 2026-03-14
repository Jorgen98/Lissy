/*
 * File: Mode.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Union type for transport modes in the planner (inspired by currently available OTP transport modes).
 */

// Create as an array of strings first so it can be used in the zod TripSchema for validation
export const modes = [
  "WALK", "CAR", "BUS", "AIRPLANE", "CABLE_CAR",
  "CARPOOL", "COACH", "FERRY", "FUNICULAR", "GONDOLA",
  "MONORAIL", "RAIL", "SUBWAY", "TAXI", "TRAM", "TROLLEYBUS"
] as const;

// The actual type
export type Mode = (typeof modes)[number];