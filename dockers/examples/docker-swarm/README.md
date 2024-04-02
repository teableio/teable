# Teable Deployment with Docker Swarm

This guide provides step-by-step instructions on how to deploy Teable using Docker Swarm, including initializing the
swarm, deploying services, and managing updates and service removal.

## Initialization

First, initialize your Docker Swarm environment:

```shell
docker swarm init
# Or specify the advertise address manually if needed:
# docker swarm init --advertise-addr 192.168.99.100
```

## Deploying Services

Use the provided `deploy.sh` script to deploy your services. You can specify the service type and stack name as
arguments:

```shell
# Syntax: ./deploy.sh [service_type] [stack_name]
./deploy.sh - example

# To view the current services:
docker service ls

# To deploy and configure updates for your application:
./deploy.sh app example
```

## Managing Services

### Removing a Service

To remove a deployed service, use the following command:

```shell
docker stack rm example
```

### Rolling Updates

For rolling updates of the application, forcing a re-deployment of the current configuration:

```shell
docker service update --force example_teable
```

## Additional Notes

### Cleaning Up Shutdown Containers

To clean up containers that are in a shutdown state:

```shell
docker rm $(docker stack ps --no-trunc -f "desired-state=shutdown" --format "{{.Name}}.{{.ID}}" example)
```

This guide outlines the basic steps for deploying and managing your Teable application with Docker Swarm, including
service deployment, updates, and cleanup procedures.
