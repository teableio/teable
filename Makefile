SHELL := /usr/bin/env bash

DOCKER_COMPOSE ?= docker compose

DOCKER_COMPOSE_ENV_FILE := $(wildcard ./dockers/.env)
COMPOSE_FILES := $(wildcard ./dockers/*.yml)
COMPOSE_FILE_ARGS := --env-file $(DOCKER_COMPOSE_ENV_FILE) $(foreach yml,$(COMPOSE_FILES),-f $(yml))

NETWORK_MODE ?= teablenet
CI_JOB_ID ?= 0

# Timeout used to await services to become healthy
TIMEOUT ?= 300

SCRATCH ?= /tmp

UNAME_S := $(shell uname -s)

# If the first make argument is "start", "stop"...
ifeq (docker.start,$(firstword $(MAKECMDGOALS)))
    SERVICE_TARGET = true
else ifeq (docker.stop,$(firstword $(MAKECMDGOALS)))
    SERVICE_TARGET = true
else ifeq (docker.restart,$(firstword $(MAKECMDGOALS)))
    SERVICE_TARGET = true
else ifeq (docker.up,$(firstword $(MAKECMDGOALS)))
    SERVICE_TARGET = true
else ifeq (docker.build,$(firstword $(MAKECMDGOALS)))
    SERVICE_TARGET = true
else ifeq (build-nocache,$(firstword $(MAKECMDGOALS)))
    SERVICE_TARGET = true
else ifeq (docker.await,$(firstword $(MAKECMDGOALS)))
    SERVICE_TARGET = true
else ifeq (docker.run,$(firstword $(MAKECMDGOALS)))
    RUN_TARGET = true
else ifeq (docker.integration,$(firstword $(MAKECMDGOALS)))
    INTEGRATION_TARGET = true
endif

ifdef SERVICE_TARGET
    # .. then use the rest as arguments for the make target
    SERVICE := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
    # ...and turn them into do-nothing targets
    $(eval $(SERVICE):;@:)
else ifdef RUN_TARGET
    # Isolate second argument as service, the rest is arguments for run command
    SERVICE := $(wordlist 2, 2, $(MAKECMDGOALS))
    SERVICE_ARGS := $(wordlist 3, $(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
else ifdef INTEGRATION_TARGET
    # Isolate second argument as integration module, the rest as arguments
    INTEGRATION_MODULE := $(wordlist 2, 2, $(MAKECMDGOALS))
     $(eval $(INTEGRATION_MODULE):;@:)
    INTEGRATION_ARGS := $(wordlist 3, $(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
    $(eval $(INTEGRATION_ARGS):;@:)
endif

#
# Never use the network=host mode when running CI jobs, and add extra
# distinguishing identifiers to the network name and container names to
# prevent collisions with jobs from the same project running at the same
# time.
#
ifneq ($(CI_JOB_ID),)
    NETWORK_MODE := teablenet-$(CI_JOB_ID)
endif


ifeq ($(UNAME_S),Linux)
	DOCKER_GID ?= $(shell getent group docker | cut -d: -f 3)
else ifeq ($(UNAME_S),Darwin)
	DOCKER_GID ?= $(shell id -g)
else
    $(error Sorry, '${UNAME_S}' is not supported yet)
endif


DOCKER_COMPOSE_ARGS := DOCKER_UID=$(shell id -u) \
	DOCKER_GID=$(DOCKER_GID) \
    NETWORK_MODE=$(NETWORK_MODE)


define print_db_mode_options
@echo -e "\nSelect a database to start."
@echo -e "\n\tsqlite			Lightweight embedded, ideal for mobile and embedded systems, simple, resource-efficient, "
@echo -e "\t\t\t\teasy integration (default database)"
@echo -e "\tpostges(pg)		Powerful and scalable, suitable for complex enterprise needs, highly customizable, rich community support\n"
endef

define print_db_push_options
@echo -e "The 'db pull' command connects to your database and adds Prisma models to your Prisma schema that reflect the current database schema.\n"
@echo -e "0) sqlite"
@echo -e "1) postges(pg)\n"
endef

.PHONY: db-mode sqlite-mode postgres-mode gen-prisma-schema gen-sqlite-prisma-schema gen-postgres-prisma-schema
.DEFAULT_GOAL := help

docker.create.network:
ifneq ($(NETWORK_MODE),host)
	docker network inspect $(NETWORK_MODE) &> /dev/null || ([ $$? -ne 0 ] && docker network create $(NETWORK_MODE))
endif

docker.rm.network:
ifneq ($(NETWORK_MODE),host)
	docker network inspect $(NETWORK_MODE) &> /dev/null && ([ $$? -eq 0 ] && docker network rm $(NETWORK_MODE)) || true
endif

docker.build:
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) build --parallel --progress=plain $(SERVICE)

docker.run: docker.create.network
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) run -T --no-deps --rm $(SERVICE) $(SERVICE_ARGS)

docker.up: docker.create.network
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) up --no-recreate -d $(SERVICE)

docker.down: docker.rm.network
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) down

docker.start:
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) start $(SERVICE)

docker.stop:
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) stop $(SERVICE)

docker.restart:
	make docker.stop $(SERVICE)
	make docker.start $(SERVICE)

TIME := 0
docker.await: ## max timeout of 300
	@time=$(TIME); \
	for i in $(SERVICE); do \
		current_service=$$($(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) ps -q $${i}); \
		if [ -z "$${current_service}" ]; then \
			continue; \
		fi; \
		service_has_health=$$(docker inspect -f '{{.State.Health.Status}}' $${current_service}); \
		if [ -z "$${service_has_health}" ]; then \
			continue; \
		fi; \
		while [ "$$(docker inspect -f '{{.State.Health.Status}}' $${current_service})" != "healthy" ] ; do \
			sleep 1; \
			time=$$(expr $$time + 1); \
			if [ $${time} -gt $(TIMEOUT) ]; then \
				echo "Timeout reached waiting for $${i} to become healthy"; \
				docker logs $${i}; \
				exit 1; \
			fi; \
		done; \
		echo "Service $${i} is healthy"; \
	done

docker.status:
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) ps

docker.images:
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) images

sqlite.integration.test: docker.create.network
	make docker.build integration-test
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) run -T --no-deps --rm \
		-e PRISMA_DATABASE_URL=file:../../db/main.db \
		integration-test bash -c \
			'make sqlite-mode && \
				yarn workspace @teable-group/backend test:e2e'

postgres.integration.test: docker.create.network
	make docker.build integration-test
	docker rm -fv teable-postgres-$(CI_JOB_ID)
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) run -d -T --no-deps --rm --name teable-postgres-$(CI_JOB_ID) teable-postgres
	$(DOCKER_COMPOSE_ARGS) $(DOCKER_COMPOSE) $(COMPOSE_FILE_ARGS) run -T --no-deps --rm \
		-e PRISMA_DATABASE_URL=postgresql://teable:teable@teable-postgres:5432/teable?schema=public \
		integration-test bash -c \
			'chmod +x ./scripts/wait-for-it.sh && ./scripts/wait-for-it.sh teable-postgres:5432 --timeout=30 -- \
				make postgres-mode && \
				yarn workspace @teable-group/backend test:e2e'

gen-sqlite-prisma-schema:
	@cd ./packages/db-main-prisma; \
		echo '{ "PRISMA_PROVIDER": "sqlite" }' | yarn mustache - ./prisma/template.prisma > ./prisma/sqlite/schema.prisma
	@echo 'generate【 prisma/sqlite/schema.prisma 】success.'

gen-postgres-prisma-schema:
	@cd ./packages/db-main-prisma; \
		echo '{ "PRISMA_PROVIDER": "postgres" }' | yarn mustache - ./prisma/template.prisma > ./prisma/postgres/schema.prisma
	@echo 'generate【 prisma/postgres/schema.prisma 】success.'

gen-prisma-schema: gen-sqlite-prisma-schema gen-postgres-prisma-schema		## Generate 'schema.prisma' files for all versions of the system

sqlite-db-push:		## db-push by sqlite
	@cd ./packages/db-main-prisma; \
		yarn prisma-db-push --schema ./prisma/sqlite/schema.prisma

postgres-db-push:		## db-push by postgres
	@cd ./packages/db-main-prisma; \
		yarn prisma-db-push --schema ./prisma/postgres/schema.prisma

db-push:		## connects to your database and adds Prisma models to your Prisma schema that reflect the current database schema.
	$(print_db_push_options)
	@read -p "Enter a command: " command; \
    if [ "$$command" = "0" ] || [ "$$command" = "sqlite" ]; then \
      make gen-sqlite-prisma-schema; \
      make sqlite-db-push; \
    elif [ "$$command" = "1" ] || [ "$$command" = "postges" ] || [ "$$command" = "pg" ]; then \
      	make gen-postgres-prisma-schema; \
		make postgres-db-push; \
    else echo "Unknown command.";  fi

sqlite-mode:		## sqlite-mode
	@cd ./packages/db-main-prisma; \
		yarn prisma-generate --schema ./prisma/sqlite/schema.prisma; \
		yarn prisma-migrate deploy --schema ./prisma/sqlite/schema.prisma

postgres-mode:		## postgres-mode
	@cd ./packages/db-main-prisma; \
		yarn prisma-generate --schema ./prisma/postgres/schema.prisma; \
		yarn prisma-migrate deploy --schema ./prisma/postgres/schema.prisma

db-mode:		## db-mode
	$(print_db_mode_options)
	@read -p "Enter a command: " command; \
    if [ "$$command" = "sqlite" ]; then make sqlite-mode; \
    elif [ "$$command" = "postges" ] || [ "$$command" = "pg" ]; then \
		make docker.up teable-postgres; \
    	make docker.await teable-postgres; \
    	make postgres-mode; \
    else echo "Unknown command.";  fi

help:   ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
