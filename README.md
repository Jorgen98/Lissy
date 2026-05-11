# Lissy

## Public Transport System Analysis and Trip Planning Tool

The application autonomously monitors and records the behaviour of transport system. After the initial start-up, an initialization procedure takes place, after which the initial model of the transport system is located in the application. The regular data processing follows at 3:00 a.m. every day. The processed data can be visualised and analysed using the client application.

### Multimodal Trip Planner

A multimodal trip planner is also integrated into the tool and uses the processed data. The planner module enables users to plan journeys combining multiple transport modes. This feature was implemented as a bachelor thesis (xvcelaa00@stud.fit.vutbr.cz). Key features include:

- **Multimodal Routing**: Combine public transport, car, and walking
- **Multi-point Planning**: Support for trips with midpoints
- **Return Trips**: Suggestion of return trips when requested
- **Public Transport Rerouting**: Rerouting to alternative connections when needed
- **Trip Option Rating**: Evaluation of trip options based on multiple criteria:
  - Travel time
  - Total cost (including fuel prices and transit fares)
  - Environmental emissions
  - Transfer counts
- **Other Features**:
  - Finding Park And Ride trips with suitable transfer hubs
  - Reverse geocoding for location-based place names
  - Trip shape visualization on an interactive map
  - Extra user settings (max walking distance, preferred transport modes, fuel prices, etc.)
  - Trip import/export functionality
  - Theme and map tile switching

## Note on transport networks

The tool needs transport network in custom format for the whole monitored transport system area. The format consists of an array of points and indices and neighbours that can be navigated to from a given point. In order to be able to use the tool, it is necessary to supply the appropriate map documents in the given format to the `/backend/backups` folder. Example files can be found in `/backend/transport_networks` folder.

## How to run

### Clear run

 1. Create new subfolder `/backend/backups` and insert **transport networks** for selected transport modes
 2. Copy **example.env** and create new file **.env** in `/env` directory
 3. In **.env** file set **DB_POSTGIS_PASSWORD**, **DB_STATS_PASSWORD**, **DB_CACHE_TOKEN** passwords
 4. In **.env** set API token variable **BE_API_MODULE_TOKEN**
 5. In **.env** set **BE_PROCESSING_GTFS_LINK** link to gtfs.zip file discrebing the public transport system
 6. In **.env** set **BE_PROCESSING_ROUTES** regex to which routes do you want to process
 7. In **.env** set **BE_PLANNER_MODULE_SERVICE** to select an external routing engine in the planner module (Currently supported: `otp`, `valhalla`, Recommended: `otp`) 
 8. In **.env** set **BE_PLANNER_{service-name}_URL** link to a running instance of the selected routing engine
 9. In **.env** set **BE_PLANNER_USER_AGENT_EMAIL** with an email, which will be sent in the `User-Agent` header of HTTP requests to external services (`Nominatim`, `Overpass`)
 10. Run application with `sudo make prod` command for production. For development, see **Development** section below in this file.
 11. Application is running on **server_ip/lissy**

### Stop application

`sudo make stop`

### Development

Run only DBs: `sudo make -f MakefileDev development-dbs-only`
Run only UI without processing server: `sudo make -f MakefileDev development-ui-only`

Run only some parts:

 - Processing server: `cd backend && npm install && npm run be-processing-start`
 - API server: `cd backend && npm install && npm run be-api-start`
    - Use `npm run be-api-start-watch` instead to run with file change detection
 - Client application: `cd frontend && npm install && npm start`