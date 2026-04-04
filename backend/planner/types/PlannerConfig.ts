/*
 * File: PlannerConfig.ts
 * Author: Adam Vcelar (xvcelaa00@stud.fit.vut.cz)
 *
 * Type for an object reflecting a row of the planner_config table in the DB.
 */

export type PlannerConfig = {
    id: number,
    config_name: string,
    fuel_price_default: string,
    avg_fuel_consumption_default: string,
    car_maintenance_factor: string,
    emission_factor_car: number,
    emission_factor_bus: number,
    emission_factor_ferry: number,
    emission_factor_rail: number,
    emission_factor_tram: number,
    emission_factor_trolleybus: number,
    clustering_factor: string,
    transfer_hub_score: number,
    park_and_ride_decision_score: number,
    park_and_ride_decision_distance: number,
    transfer_hub_min_improvement: number,
}