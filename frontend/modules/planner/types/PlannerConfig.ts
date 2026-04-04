/*
 * File: PlannerConfig.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Type for an object with fields from the planner_config table in the DB, limited to values actually needed in the frontend.
 */

export type PlannerConfig = {
    fuel_price_default: number,
    avg_fuel_consumption_default: number,
}