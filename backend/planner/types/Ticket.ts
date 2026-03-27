/*
 * File: Mode.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Custom type for fare ticket used for trip price calculation.
 */

export type Ticket = { 
    code: string, 
    zones: number, 
    duration: number,
    base_price: number,
    discounted_a_price: number,
    discounted_b_price: number, 
    is_universal: boolean,
};