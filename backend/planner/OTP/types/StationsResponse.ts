/*
 * File: OTPStationsReponse.ts
 * Author: Adam Vcelar (xvcelaa00)
 *
 * Expected response type for stations query from OTP.
 */

export type OTPStationsResponse = {
    data: {
        stations: {
            lat: number,
            lon: number,
            name: string,
        }[]
    }
}