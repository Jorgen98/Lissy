/*
 * File: AddressDetails.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Description of the address details object returned by Nominatim.
 * Only includes fields that are actually used, not all possible.
 */

export type NominatimAddressDetails = {
    state?: string,
    county?: string,
    municipality?: string,
    state_district?: string,
    city?: string,
    town?: string,
    village?: string,
    city_district?: string,
    borough?: string,
    suburb?: string,
    neighbourhood?: string,
    quarter?: string,
    industrial?: string,
    commercial?: string,
    retail?: string,
    house_number?: string,
    house_name?: string,
    historic?: string,
    natural?: string,
    place?: string,
    road?: string,
    railway?: string,
    man_made?: string,
    amenity?: string,
    aeroway?: string,
    club?: string,
    craft?: string,
    leisure?: string,
    office?: string,
    shop?: string,
    tourism?: string,
};