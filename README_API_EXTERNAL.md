# Lissy API for External Use


This document describes selected Lissy API endpoints that provide data for use in external applications. Currently, two types of data are available. The first is a representation of a trip shapes in the transport network defined using a polyline. The second type of data contains the recorded delays of public transport vehicles on a given day.

> All API requests must contain the **`Authorization`** parameter in the header with the appropriate **API Token**

> All API requests work with **UTC Date format** --- **`{YYYY}-{MM}-{DD}`** --- **`{1970-2025}-{0-11}-{1-31}`**

## Trip Shapes

Using the following endpoints, it is possible to obtain the exact shapes of the trips with the positions of the stops that the trip passes through. The specific trip can be obtained using 3 steps.

### 1. Available dates

> [/lissy/api/shapes/availableDates]()

This endpoint returns the time interval for which shape records exist in the DB. By default, the endpoint returns a JSON document in the following format:

|Key |Data type|Description|
|-|-|-|
|start|`Number`|Start of interval, date representing the oldest records|
|disabled|`Number[]`|Calendar days within the interval when data is unavailable|
|end|`Number`|End of interval, date representing the most recent records, typically today's date|

### 2. Available routes

> [/lissy/api/shapes/getShapes/{date}]()

> [/lissy/api/shapes/getShapes?date=2025-2-31]()

This endpoint returns all available shapes for the selected date, grouped by route. By default, the endpoint returns a list of JSON documents in the following format:

|Key|Data type|Description|
|-|-|-|
|route_short_name|`String`|Public route label|
|route_color|`String`|Route color scheme|
|trips|`{shape_id: Number, stops: String}[]`|List of available shapes belonging to a specific route|

### 3. Specific shape

> [/lissy/api/shapes/getShape/{shape_id}]()

> [/lissy/api/shapes/getShape?shape_id=1502]()

This endpoint returns a specific shape for the selected id. By default, the endpoint returns a JSON document in the following format:

|Key|Data type|Description|
|-|-|-|
|coords|`[Number, Number][][]`|Single shape polyline, divided into sections according to stops on the route|
|stops|`{stop_name: String, wheelchair_boarding: Number, zone_id: Number, coords: [Number, Number]}[]`|Detailed description of stops along the shape|

## Trip Delays

The following endpoints can be used to retrieve the stored delay values for the selected trip in the selected time range.

### 1. Available dates

> [/lissy/api/delayTrips/availableDates]()

This endpoint returns the time interval for which delay records exist in the DB. By default, the endpoint returns a JSON document in the following format:

|Key|Data type|Description|
|-|-|-|
|start|`Number`|Start of interval, date representing the oldest records|
|disabled|`Number[]`|Calendar days within the interval when data is unavailable|
|end|`Number`|End of interval, date representing the most recent records, typically today's date|

### 2. Available routes

> [/lissy/api/delayTrips/getAvailableRoutes/{\[\[date, date\]\]}]()

> [/lissy/api/delayTrips/getAvailableRoutes?dates=[["2025-0-21","2025-0-21"]]]()

> [/lissy/api/delayTrips/getAvailableRoutes?dates=[["2025-0-20","2025-0-21"]]]()

> [/lissy/api/delayTrips/getAvailableRoutes?dates=[["2025-0-17","2025-0-17"],["2025-0-19","2025-0-19"],["2025-0-21","2025-0-21"]]]()

This endpoint returns for the selected time range the routes for which any delay records are available. By default, the endpoint returns a list of JSON documents in the following format:

|Key|Data type|Description|
|-|-|-|
|route_short_name|`String`|Public route label|
|id|`Number`|Internal route label|

### 3. Available trips

> [/lissy/api/delayTrips/getAvailableTrips/{\[\[date, date\]\]}{route_id}{fullStopOrder}]()

> [/lissy/api/delayTrips/getAvailableTrips?dates=[["2025-0-17","2025-0-17"]]&route_id=30]()

> [/lissy/api/delayTrips/getAvailableTrips?dates=[["2025-0-17","2025-0-19"],["2025-0-21","2025-0-21"]]&route_id=30]()

> [/lissy/api/delayTrips/getAvailableTrips?dates=[["2025-0-17","2025-0-17"]]&route_id=30&fullStopOrder=true]()

This endpoint returns the available trips for the selected time range, grouped by their routes. By default, the endpoint returns a list of JSON documents in the following format:

|Key|Data type|Description|
|-|-|-|
|shape_id|`Number`|Internal shape label|
|stops|`String`|Shape label with start and end stops|
|trips|`{id: Number, dep_time: Number}[]`|List of available trips|

### 4. Delay data

> [/lissy/api/delayTrips/getTripData/{\[\[date, date\]\]}{trip_id}]()

> [/lissy/api/delayTrips/getTripData?dates=[["2025-0-17","2025-0-17"]]&trip_id=19204]()

> [/lissy/api/delayTrips/getTripData?dates=[["2025-0-17","2025-0-19"],["2025-0-21","2025-0-21"]]&trip_id=19204]()

This endpoint returns the delay values stored for the selected time range and trip. The individual entries correspond to elements of a polyline that represents the trip's shape. By default, the endpoint returns a list of JSON objects. The key of each record is the **date** for which the record is valid. Each object then contains records indexed so that they can be matched to individual elements of the trip's route. Example:

##### Shape:

    {
		"coords": [
			[[49.235310262,16.586527899],[49.235278498,16.586635709],[49.235241719,16.586753726]],
			[[49.240559905,16.583851989],[49.240702162,16.583755016]]
		]
	}

##### Trip delays:

    {
		"1741474800000": {
			"0": {
				"1": 0
			},
			"1": {
				"0": 1
			}
		}
	}

The delay records for a given day in this case refer to the 0 and 1 inter-stop segment and specifically, for **the zero segment**, only to the segment between coords `1` and `2` with delay value *0* and for **the first segment** to the segment between coords `0` and `1` point with delay value *1*.

## Weather

The following endpoints returns historical weather data of defined points of interest.

### 1. All points

> [/lissy/api/weather/data/{from}{to}]()

> [/lissy/api/weather/data?from=1735686000000&to=1767222000000]()

### 2. Selected point

> [/lissy/api/weather/data/{from}{to}{positionId}]()

> [/lissy/api/weather/data?from=1735686000000&to=1767222000000&positionId=0]()

### 3. Available positions

> [/lissy/api/weather/positions]()
