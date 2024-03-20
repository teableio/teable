#!/bin/sh

create_network() {
  docker network create -d overlay teable-swarm || true
}

export_env_vars() {
  if [ -f .env ]; then
    # see https://github.com/moby/moby/issues/29133
    export $(grep -v '^#' .env | xargs)
  else
    echo ".env file not found, skipping export."
  fi
}

deploy_stack() {
  compose_files="$1"               # Compose files to use for deployment
  stack_name="${2:-default_stack}" # Stack name with a default value if not provided

  echo "Deploying services with stack name '$stack_name' using compose files: $compose_files"
  docker stack deploy -c docker-compose.default.yml $compose_files $stack_name
}

show_help() {
  echo "Usage: $0 [service_type] [stack_name]"
  echo "service_type: The type of service to deploy (kit, app, gateway). Leave empty to deploy all."
  echo "stack_name: The name of the stack. Optional."
  echo "Examples:"
  echo "  $0 kit - Deploys the 'kit' service stack."
  echo "  $0 app default_stack - Deploys the 'app' service stack with a specific stack name."
  echo "  $0 - Deploys all services with default stack name."
}

deploy_service() {
  service_type=$1
  stack_name=$2

  if [ -z "$1" ] || [ "$1" = "help" ]; then
    show_help
    exit 0
  fi

  create_network
  export_env_vars

  case $service_type in
  "kit")
    deploy_stack "-c docker-compose.kit.yml" $stack_name
    ;;
  "app")
    deploy_stack "-c docker-compose.app.yml" $stack_name
    ;;
  "gateway")
    deploy_stack "-c docker-compose.gateway.yml" $stack_name
    ;;
  *)
    # Deploy all services if no specific service type is provided
    deploy_stack "-c docker-compose.kit.yml -c docker-compose.app.yml -c docker-compose.gateway.yml" $stack_name
    ;;
  esac
}

# $1 is the service type (kit, app, gateway) or empty for all services
# $2 is the stack name, optional
deploy_service $1 $2
