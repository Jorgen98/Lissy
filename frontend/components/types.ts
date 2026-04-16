export type routeFromDB = {
    id: number,
    route_type: number,
    route_id: string,
    route_short_name: string,
    route_color: string,
    route_text_color: string
}

export type shapeWithTripsFromDB = {
    shape_id: number,
    stops: string
    trips: tripFromDB[]
}

export type tripFromDB = {
    id: number,
    dep_time: string
}