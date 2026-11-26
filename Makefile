run:
	docker compose up lissy-proxy-server lissy-be-processing lissy-fe lissy-be-api lissy-db-postgis lissy-db-stats lissy-db-cache lissy-martin-prediction --build
prod:
	docker compose up lissy-proxy-server lissy-be-processing lissy-fe lissy-be-api lissy-db-postgis lissy-db-stats lissy-db-cache lissy-martin-prediction --build -d
stop:
	docker compose down lissy-be-api lissy-proxy-server lissy-be-processing lissy-fe lissy-db-postgis lissy-db-stats lissy-db-cache lissy-martin-prediction
