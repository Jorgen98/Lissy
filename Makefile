run:
	docker compose --env-file ./env/.env up proxy be-processing fe be-api db-postgis db-stats db-cache --build
run-in-prod:
	docker compose --env-file ./env/.env up proxy be-processing fe be-api db-postgis db-stats db-cache --build -d
stop:
	docker container stop lissy-be-api lissy-proxyServer lissy-be-processing lissy-fe lissy-db-postgis lissy-db-stats lissy-db-cache