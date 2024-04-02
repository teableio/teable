# Setup Instructions for Teable Cluster

Before executing `docker compose up -d`, ensure to update the variables in the `.env` file according to your
environment's requirements.

## Teable Configuration

- **Access URL:** Access the Teable interface via [http://127.0.0.1:80](http://127.0.0.1:80).
- **Database Storage:** Utilizes PostgreSQL database for data storage.
- **Telemetry:** Telemetry collection is disabled by default.

## MinIO Endpoint Configuration

When configuring the Teable cluster to use MinIO for storage, it's necessary to replace the
placeholder `<MINIO_ENDPOINT>` in the `.env` file with the appropriate endpoint:

- **For Intranet Use:** Replace `<MINIO_ENDPOINT>` with the IP address of the host where MinIO is deployed. This setup
  is recommended if MinIO and Teable are on the same network.

- **For Extranet Use:** Replace `<MINIO_ENDPOINT>` with the domain name or extranet IP address of your MinIO instance.
  Use this configuration if you need to access MinIO from outside your local network.

## Public Database Proxy Configuration

To ensure smooth native database connections, you need to set the `PUBLIC_DATABASE_PROXY` variable in the `.env` file to
its default value, `127.0.0.1:42345`. This port should match the port specified for the `teable-db` container in
the `docker-compose.yaml` file's `ports` attribute and can be adjusted to suit your needs.

**Important Note:** When using ports `80` or `443`, it's essential to explicitly specify the port number in the URL.
Failing to do so is not allowed. This practice guarantees accurate address resolution and dependable connectivity,
providing a solid foundation for your database connections.

Ensure to review and adjust these configurations to match your deployment environment before starting the Teable
cluster.
