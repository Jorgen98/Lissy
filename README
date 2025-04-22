# Lissy

## Public Transport System Analysis Tool

The application autonomously monitors and records the behaviour of transport system. After the initial start-up, an initialization procedure takes place, after which the initial model of the transport system is located in the application. The regular data processing follows at 2:15 a.m. every day. The processed data can be visualised and analysed using the client application.

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
 7. Run application with `sudo make run-in-prod` command
 8. Application is running on **server_ip:7000/lissy**

### Stop application

`sudo make stop`

### Development

Run only DBs: `sudo make -f MakefileDev development-dbs-only`
Run only UI without processing server: `sudo make -f MakefileDev development-ui-only`

Run only some parts of backend:

 - Processing server: `cd backend && npm install && npm run be-processing-start`
 - API server: `cd backend && npm install && npm run be-api-start`
 - Client application: `cd frontend && npm start`