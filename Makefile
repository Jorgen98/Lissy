run:
	docker compose --env-file ./env/.env up lissy-proxy-server lissy-be-processing lissy-fe lissy-be-api lissy-db-postgis lissy-db-stats lissy-db-cache --build
prod:
	docker compose --env-file ./env/.env up lissy-proxy-server lissy-be-processing lissy-fe lissy-be-api lissy-db-postgis lissy-db-stats lissy-db-cache --build -d
stop:
	docker container stop lissy-be-api lissy-proxy-server lissy-be-processing lissy-fe lissy-db-postgis lissy-db-stats lissy-db-cache