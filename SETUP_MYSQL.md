# Setting Up Teable with MySQL Locally

This guide will help you set up and run Teable locally with MySQL as your database.

## Prerequisites

1. **Node.js** (>=22.0.0) and **pnpm** (>=9.13.0)
2. **MySQL** server running locally (or accessible remotely)
3. **Corepack** enabled

## Step 1: Install Dependencies

```bash
# Enable corepack (if not already enabled)
corepack enable

# Install all project dependencies
pnpm install
```

## Step 2: Generate MySQL Prisma Schema

Since MySQL support was just added, you need to generate the MySQL Prisma schema:

```bash
make gen-mysql-prisma-schema
```

This will create `packages/db-main-prisma/prisma/mysql/schema.prisma`.

## Step 3: Set Up Environment Variables

### Option A: Using MySQL-specific environment variables (Recommended)

Create or edit `apps/nextjs-app/.env.development.local`:

```env
# Database Connection
PRISMA_DATABASE_URL=mysql2://root:your_password@localhost:3306/your_database_name

# MySQL Writer Connection (optional, used if provided)
WRITER_DB_SCHEMA=your_database_name
WRITER_DB_USERNAME=root
WRITER_DB_PASSWORD=your_password
WRITER_DB_HOSTNAME=localhost
WRITER_DB_PORT=3306
WRITER_DB_POOL_MIN=1
WRITER_DB_POOL_MAX=10
WRITER_DB_POOL_ACQUIRE=30000
WRITER_DB_POOL_IDLE=10000

# MySQL Reader Connection (optional, for read/write splitting)
READER_DB_SCHEMA=your_database_name
READER_DB_USERNAME=root
READER_DB_PASSWORD=your_password
READER_DB_HOSTNAME=localhost
READER_DB_PORT=3306
READER_DB_POOL_MIN=1
READER_DB_POOL_MAX=10
READER_DB_POOL_ACQUIRE=30000
READER_DB_POOL_IDLE=10000

# Application Settings
PUBLIC_ORIGIN=http://localhost:3000
PORT=3000
NODE_ENV=development

# Optional: Cache Configuration
BACKEND_CACHE_PROVIDER=memory
```

### Option B: Using only PRISMA_DATABASE_URL

If you prefer to use only the connection string:

```env
PRISMA_DATABASE_URL=mysql2://root:your_password@localhost:3306/your_database_name
PUBLIC_ORIGIN=http://localhost:3000
PORT=3000
NODE_ENV=development
```

## Step 4: Prepare MySQL Database

Make sure your MySQL database exists and is accessible:

```bash
# Connect to MySQL and create the database if it doesn't exist
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS your_database_name;"
```

## Step 5: Run Database Migrations

Push the Prisma schema to your MySQL database:

```bash
cd packages/db-main-prisma
pnpm prisma-db-push --schema ./prisma/mysql/schema.prisma
```

Or generate and run migrations:

```bash
# Generate Prisma client for MySQL
cd packages/db-main-prisma
pnpm prisma-generate --schema ./prisma/mysql/schema.prisma

# Run migrations (if you have migration files)
pnpm prisma-migrate deploy --schema ./prisma/mysql/schema.prisma
```

## Step 6: Build Packages (First Time Only)

Before running the dev server for the first time, build the packages:

```bash
pnpm build:packages
```

## Step 7: Start the Development Server

The backend will automatically start the frontend (Next.js) server:

```bash
cd apps/nestjs-backend
pnpm dev
```

This will:

- Start the NestJS backend server
- Automatically start the Next.js frontend server
- Enable hot reload for both servers

## Step 8: Access the Application

Once the servers are running, you can access:

- **Frontend (UI)**: http://localhost:3000
- **Backend API**: http://localhost:3000/api (or check the console for the exact port)
- **API Documentation**: http://localhost:3000/api-docs (if Swagger is enabled)

## Troubleshooting

### Port Conflicts

If port 3000 is already in use:

```bash
# Check what's using the port
lsof -i:3000

# Kill the process if needed
kill -9 [PID]
```

### Database Connection Issues

1. **Verify MySQL is running:**

   ```bash
   mysql -u root -p -e "SELECT 1;"
   ```

2. **Check connection string format:**

   - Format: `mysql2://username:password@host:port/database`
   - Make sure special characters in passwords are URL-encoded

3. **Verify database exists:**
   ```bash
   mysql -u root -p -e "SHOW DATABASES LIKE 'your_database_name';"
   ```

### Prisma Client Issues

If you see errors about Prisma client:

```bash
cd packages/db-main-prisma
pnpm prisma-generate --schema ./prisma/mysql/schema.prisma
```

### Module Not Found Errors

If you see module resolution errors:

```bash
# Clean and reinstall
pnpm clean:global-cache
pnpm install
pnpm build:packages
```

## Development Workflow

### Making Code Changes

- Backend changes: The NestJS server will auto-reload
- Frontend changes: Next.js will hot-reload automatically
- Package changes: You may need to rebuild packages:
  ```bash
  pnpm build:packages
  ```

### Database Schema Changes

If you modify the Prisma schema:

1. Update `packages/db-main-prisma/prisma/template.prisma`
2. Regenerate MySQL schema:
   ```bash
   make gen-mysql-prisma-schema
   ```
3. Push changes to database:
   ```bash
   cd packages/db-main-prisma
   pnpm prisma-db-push --schema ./prisma/mysql/schema.prisma
   ```

## Additional Notes

- **WebSocket Port**: In development, Next.js uses port 3000 for hot reload. The application's WebSocket uses port 3001 to avoid conflicts.
- **Plugin Development**: To develop plugins, start the plugin server separately:
  ```bash
  cd plugins
  pnpm dev
  ```
  This runs on port 3002.

## Next Steps

Once everything is running:

1. Open http://localhost:3000 in your browser
2. Create your first account
3. Start building your database!
