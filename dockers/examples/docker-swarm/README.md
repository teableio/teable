# Example with teable by Docker swarm deploy

```shell

# Init
docker swarm init
#  or specify the address manually
#  docker swarm init --advertise-addr 192.168.99.100


# ./deploy.sh [service_type] [stack_name]
./deploy.sh - example

# view services
docker service ls

# update app service
./deploy.sh app example

# remove service
docker stack rm example
```
