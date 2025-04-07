# Contributing

The base branch is **`develop`**.

## Development Setup

> **Note**
> The following commands are for Linux/Mac environments. For Windows, please use WSL2.

### 1. Initial Setup

```bash
# Enable the Package Manager
corepack enable

# Install project dependencies
pnpm install
```

### 2. Database Selection
We support SQLite (dev only) and PostgreSQL. PostgreSQL is recommended and requires Docker installed.

```bash
# Switch between SQLite and PostgreSQL
make switch-db-mode
```

### 3. Environment Configuration (Optional)
```bash
cd apps/nextjs-app
cp .env.development .env.development.local
```

### 4. Start Development Server
```bash
cd apps/nestjs-backend
pnpm dev
```
This will automatically start both backend and frontend servers with hot reload enabled.

## Continuous Development

After pulling the latest code, ensure your development environment stays up-to-date:

```bash
# Update dependencies to latest versions
pnpm install

# Update database schema to latest version
make switch-db-mode
```

### Known Issues

Port conflict: In dev mode, code changes trigger hot reloading. If changes affect app/nestjs-backend (packages/core, packages/db-main-prisma), nodejs may restart, potentially causing port conflicts.
If backend code changes seem ineffective, check if the port is occupied with `lsof -i:3000`. If so, kill the old process with `kill -9 [pid]` and restart the application with `pnpm dev`.

Websocket: In development, Next.js occupies port 3000 for websocket to trigger hot reloading. To avoid conflicts, the application's websocket uses port 3001. That's why you see SOCKET_PORT=3001 in .env.development.local, while in production, port 3000 is used by default for websocket requests.

## Database Migration Workflow

Teable uses Prisma as ORM for database management. Follow these steps for schema changes:

1. Modify `packages/db-main-prisma/prisma/template.prisma`

2. Generate Prisma schemas:
```bash
make gen-prisma-schema
```
This generates both SQLite and PostgreSQL schemas and TypeScript definitions.

3. Create migrations file:
```bash
make db-migration
```

4. Apply migrations:
```bash
make switch-db-mode
```

> **Note**
> If you need to modify the schema after applying migrations, you need to delete the latest migration file and run `pnpm prisma-migrate-reset` in `packages/db-main-prisma` to reset the database. (Make sure you run it in the development database.)

## Testing

### E2E Tests
Located in `apps/nestjs-backend`:

```bash
# First-time setup
pnpm pre-test-e2e

# Run all E2E tests
pnpm test-e2e

# Run specific test file
pnpm test-e2e [test-file]
```

### Unit Tests
```bash
# Run all unit tests
pnpm g:test-unit

# Run tests in specific package
cd packages/[package-name]
pnpm test-unit

# Run specific test file
pnpm test-unit [test-file]
```

### IDE Integration
Using VSCode/Cursor:
1. For E2E tests in `apps/nestjs-backend`:
   - Switch to test file (e.g. `apps/nestjs-backend/test/record.e2e-spec.ts`)
   - Select "vitest e2e nest backend" in Debug panel

2. For unit tests in different packages:
   - For `packages/core`: 
     - Switch to test file (e.g. `packages/core/src/utils/date.spec.ts`)
     - Select "vitest core" in Debug panel
   - For other packages, select their corresponding debug configuration

Each package has its own debug configuration in VSCode/Cursor, make sure to select the matching one for the package you're testing.

## Git Commit Convention

This repo follows [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) format.

### Common Prefixes
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **test**: Adding or modifying tests
- **refactor**: Code changes that neither fix bugs nor add features
- **style**: Changes to styling/CSS
- **chore**: Changes to build process or tools

> **Note**
> Full configuration can be found in [commitlint.config.js](https://github.com/teableio/teable/blob/main/commitlint.config.js)

## Docker Build

### Building Images Locally
- `teable`: The main application image

#### Build the Application Image
> **Note**
> You should run this command in the root directory.

```bash
# Build the main application image
docker build -f dockers/teable/Dockerfile -t teable:latest .

# Build for a specific platform (e.g., amd64)
docker build --platform linux/amd64 -f dockers/teable/Dockerfile -t teable:latest .
```

### Pushing to Docker Hub

```bash
# Tag your local image
docker tag teable:latest your-username/teable:latest

# Login to Docker Hub
docker login

# Push the image
docker push your-username/teable:latest
```
