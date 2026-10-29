# Architecture Détaillée du Projet Teable

**Document de référence technique**
**Version**: 1.0
**Date**: Février 2025

---

## 📚 Table des matières

1. [Diagrammes d'architecture](#1-diagrammes-darchitecture)
2. [Communication entre services](#2-communication-entre-services)
3. [Flux de données](#3-flux-de-données)
4. [Patterns et bonnes pratiques](#4-patterns-et-bonnes-pratiques)
5. [Dépendances critiques](#5-dépendances-critiques)
6. [Points d'intégration](#6-points-dintégration)
7. [Analyse des modules](#7-analyse-des-modules)

---

## 1. Diagrammes d'architecture

### 1.1 Architecture globale en couches

```
┌─────────────────────────────────────────────────────────────────┐
│                       COUCHE PRÉSENTATION                        │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│  │  Grid View   │  Form View   │  Kanban View │ Calendar View│   │
│  └──────────────┴──────────────┴──────────────┴──────────────┘   │
│  ┌──────────────┬──────────────┬──────────────────────────────┐   │
│  │   Comment    │    Share     │      Collaboration          │   │
│  │   Thread     │    Modal     │      Features              │   │
│  └──────────────┴──────────────┴──────────────────────────────┘   │
│                    React Components (Next.js)                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP/WebSocket
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│                    COUCHE MÉTIER (BUSINESS)                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    NestJS Backend                           │ │
│  │  ┌──────────────┬──────────────┬──────────────────────────┐ │ │
│  │  │   Auth       │   Access     │    Validation & Schema  │ │ │
│  │  │   Module     │   Control    │    Management           │ │ │
│  │  └──────────────┴──────────────┴──────────────────────────┘ │ │
│  │  ┌──────────────┬──────────────┬──────────────────────────┐ │ │
│  │  │   Record     │   Field      │    View Operations      │ │ │
│  │  │   Service    │   Service    │                         │ │ │
│  │  └──────────────┴──────────────┴──────────────────────────┘ │ │
│  │  ┌──────────────┬──────────────┬──────────────────────────┐ │ │
│  │  │  Attachment  │   Comment    │    Share & Permission   │ │ │
│  │  │  Manager     │   Service    │                         │ │ │
│  │  └──────────────┴──────────────┴──────────────────────────┘ │ │
│  │  ┌──────────────┬──────────────┬──────────────────────────┐ │ │
│  │  │  Aggregation │   AI Service │    Notification Service │ │ │
│  │  │  Engine      │              │                         │ │ │
│  │  └──────────────┴──────────────┴──────────────────────────┘ │ │
│  │  ┌──────────────┬──────────────┬──────────────────────────┐ │ │
│  │  │   Plugin     │   Import     │    Export Service       │ │ │
│  │  │   Manager    │   Export     │                         │ │ │
│  │  └──────────────┴──────────────┴──────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌────────────────┬────────────────┬────────────────────────────┐ │
│  │ Core Business  │ Field Formula  │  Query Language Parser     │ │
│  │ Logic          │ ANTLR4 Parser  │  (TQL)                     │ │
│  └────────────────┴────────────────┴────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Prisma ORM
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│                    COUCHE PERSISTANCE                             │
│  ┌───────────────┬───────────────┬──────────────────────────────┐ │
│  │  PostgreSQL   │     Redis      │      MinIO (S3)            │ │
│  │  Données      │     Cache      │      Stockage fichiers     │ │
│  │  principales  │     Sessions   │                            │ │
│  └───────────────┴───────────────┴──────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Architecture microservices-like

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway (Express)                          │
│                    Port 3000                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ↓                   ↓                   ↓
    ┌─────────┐         ┌──────────┐      ┌─────────────┐
    │ Auth    │         │ Record   │      │  Attachment │
    │ Service │         │ Service  │      │  Service    │
    └─────────┘         └──────────┘      └─────────────┘
         │                   │                   │
    ┌─────────┐         ┌──────────┐      ┌─────────────┐
    │ Access  │         │  View    │      │ Comment     │
    │ Token   │         │ Service  │      │ Service     │
    │ Service │         └──────────┘      └─────────────┘
    └─────────┘              │
                         ┌──────────┐
                         │  Field   │
                         │ Service  │
                         └──────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
         ┌──────────┐               ┌────────────┐
         │ Prisma   │               │  Cache     │
         │ ORM      │               │ (Redis)    │
         └──────────┘               └────────────┘
              │
         ┌──────────┐
         │PostgreSQL│
         └──────────┘
```

### 1.3 Flux de requête HTTP

```
1. USER REQUEST
   └─→ HTTP(S) POST/GET/PATCH/DELETE
       User agent → Next.js (Frontend)

2. FRONTEND PROCESSING
   └─→ React component updates state
   └─→ API call via fetch/axios
   └─→ Add JWT token to headers

3. BACKEND ROUTING
   └─→ Express/NestJS routing
   └─→ Controller method dispatch
   └─→ Guard decorators (Auth, Permission)

4. VALIDATION
   └─→ DTO validation (class-validator)
   └─→ Zod schema validation
   └─→ Return 400 if invalid

5. BUSINESS LOGIC
   └─→ Service layer execution
   └─→ Prisma ORM queries
   └─→ Cache check (Redis)

6. DATABASE OPERATION
   └─→ Query builder
   └─→ SQL execution on PostgreSQL
   └─→ Cache update

7. RESPONSE PREPARATION
   └─→ Serialize response data
   └─→ HTTP status code (200, 201, etc.)
   └─→ JSON body

8. REAL-TIME BROADCAST
   └─→ WebSocket emit (ShareDB)
   └─→ Other connected clients receive update

9. FRONTEND UPDATE
   └─→ React state update
   └─→ Component re-render
   └─→ UI reflects new data
```

---

## 2. Communication entre services

### 2.1 REST API

**Pattern**: RESTful avec HTTP methods

```typescript
// Base routes
POST   /api/v1/bases                    # Create base
GET    /api/v1/bases                    # List bases
GET    /api/v1/bases/:id                # Get base
PATCH  /api/v1/bases/:id                # Update base
DELETE /api/v1/bases/:id                # Delete base

// Table routes
POST   /api/v1/bases/:baseId/tables     # Create table
GET    /api/v1/bases/:baseId/tables     # List tables
PATCH  /api/v1/bases/:baseId/tables/:tableId
DELETE /api/v1/bases/:baseId/tables/:tableId

// Record routes
POST   /api/v1/bases/:baseId/tables/:tableId/records
GET    /api/v1/bases/:baseId/tables/:tableId/records
GET    /api/v1/bases/:baseId/tables/:tableId/records/:recordId
PATCH  /api/v1/bases/:baseId/tables/:tableId/records/:recordId
DELETE /api/v1/bases/:baseId/tables/:tableId/records/:recordId

// View routes
POST   /api/v1/bases/:baseId/tables/:tableId/views
GET    /api/v1/bases/:baseId/tables/:tableId/views
PATCH  /api/v1/bases/:baseId/tables/:tableId/views/:viewId
DELETE /api/v1/bases/:baseId/tables/:tableId/views/:viewId

// Field routes
POST   /api/v1/bases/:baseId/tables/:tableId/fields
GET    /api/v1/bases/:baseId/tables/:tableId/fields
PATCH  /api/v1/bases/:baseId/tables/:tableId/fields/:fieldId
DELETE /api/v1/bases/:baseId/tables/:tableId/fields/:fieldId

// Share routes
POST   /api/v1/bases/:baseId/shares
GET    /api/v1/bases/:baseId/shares
DELETE /api/v1/bases/:baseId/shares/:shareId

// Comment routes
POST   /api/v1/bases/:baseId/tables/:tableId/records/:recordId/comments
GET    /api/v1/bases/:baseId/tables/:tableId/records/:recordId/comments
DELETE /api/v1/bases/:baseId/tables/:tableId/records/:recordId/comments/:commentId
```

### 2.2 WebSocket Real-time

**Pattern**: ShareDB + Custom events

```typescript
// ShareDB operations (CRUD)
{
  type: 'create',
  collection: 'records',
  id: 'record-123',
  data: { /* record data */ }
}

// Custom events
connection.send({
  type: 'recordUpdate',
  payload: {
    recordId: 'record-123',
    changes: { field1: 'newValue' }
  }
})

// Subscription pattern
connection.subscribe('records', recordId, (err, doc) => {
  if (!err) {
    doc.fetch((err) => {
      if (!err) {
        doc.on('op', (op, source) => {
          // Handle operation
        });
      }
    });
  }
});
```

### 2.3 Event Bus (Internal)

**Pattern**: EventEmitter ou Observer Pattern

```typescript
// Example: Record created event
this.eventEmitter.emit('record:created', {
  recordId: 'rec-123',
  tableId: 'tbl-456',
  userId: 'user-789',
  timestamp: new Date(),
});

// Listeners
eventEmitter.on('record:created', async (data) => {
  // Update aggregations
  // Trigger webhooks
  // Send notifications
  // Broadcast via WebSocket
});
```

---

## 3. Flux de données

### 3.1 Création d'un enregistrement

```
┌──────────────┐
│ User clicks  │
│ "New Record" │
└──────┬───────┘
       │
       ↓
┌──────────────────────────────┐
│ Frontend Event Handler       │
│ - Collect form data          │
│ - Validate client-side       │
│ - Show loading state         │
└──────┬───────────────────────┘
       │
       ↓
┌──────────────────────────────┐
│ POST /api/records            │
│ Header: Authorization token  │
│ Body: { fields: {...} }      │
└──────┬───────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Backend Router → Controller              │
│ - Parse request                          │
│ - Extract JWT token from header          │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Guard: AuthGuard                         │
│ - Verify JWT token                       │
│ - Attach user to request                 │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Guard: PermissionGuard                   │
│ - Check if user can create records       │
│ - Check base/table permissions           │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ DTO Validation                           │
│ - class-validator validates DTO fields   │
│ - Type checking                          │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Service: RecordService                   │
│ - Business logic execution               │
│ - Generate record ID (UUID)              │
│ - Apply default values                   │
│ - Formula/computed field evaluation      │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ ORM: Prisma                              │
│ - Build INSERT statement                 │
│ - Execute transaction                    │
│ - Return created record                  │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Database: PostgreSQL                     │
│ - Insert row in records table            │
│ - Apply constraints/triggers             │
│ - Return inserted data                   │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Cache Update (Redis)                     │
│ - Update aggregate cache                 │
│ - Invalidate related caches              │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Event Bus                                │
│ - Emit 'record:created' event            │
│ - Trigger webhooks                       │
│ - Send notifications                     │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ WebSocket Broadcast                      │
│ - ShareDB operation broadcast            │
│ - Custom event to all connected clients  │
└──────┬───────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────┐
│ Frontend Update                          │
│ - React state update                     │
│ - Component re-render                    │
│ - Display new record in grid             │
└──────────────────────────────────────────┘
```

### 3.2 Filtrage et recherche de données

```
User Input: "Search: name contains 'John'"
            └─→ Filter configuration
                │
                ├─→ Parse filter expression
                │  └─→ Field: "name"
                │  └─→ Operator: "contains"
                │  └─→ Value: "John"
                │
                ├─→ Build WHERE clause
                │  └─→ SQL: WHERE "name" ILIKE '%John%'
                │
                ├─→ Execute query
                │  └─→ Prisma findMany({
                │      where: { name: { contains: 'John' } }
                │     })
                │
                ├─→ Return filtered records
                │
                └─→ Update UI with results
```

### 3.3 Agrégation de données

```
User selects: Aggregate "price" by "category" → SUM

┌─────────────────────────────────────┐
│ 1. Parse aggregation config         │
│    - Field: price                   │
│    - Operation: SUM                 │
│    - Group by: category             │
└──────────┬──────────────────────────┘
           │
           ↓
┌─────────────────────────────────────┐
│ 2. Build SQL query                  │
│    SELECT category,                 │
│           SUM(price) as total        │
│    FROM records                      │
│    GROUP BY category                │
└──────────┬──────────────────────────┘
           │
           ↓
┌─────────────────────────────────────┐
│ 3. Check cache (Redis)              │
│    Key: agg:table:price:SUM:category│
└──────────┬──────────────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ↓             ↓
┌────────┐  ┌─────────────┐
│ CACHE  │  │ Query DB    │
│ HIT    │  │             │
└────┬───┘  └────────┬────┘
     │               │
     └───┬───────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ 4. Format results                   │
│    {                                │
│      Electronics: 5000,             │
│      Books: 1200,                   │
│      Clothing: 800                  │
│    }                                │
└──────────┬──────────────────────────┘
           │
           ↓
┌─────────────────────────────────────┐
│ 5. Return to frontend & update UI   │
│    Render aggregation chart/table    │
└─────────────────────────────────────┘
```

---

## 4. Patterns et bonnes pratiques

### 4.1 Repository Pattern

```typescript
// Interface
interface IRecordRepository {
  create(data: CreateRecordDto): Promise<Record>;
  findById(id: string): Promise<Record>;
  findAll(query: QueryDto): Promise<Record[]>;
  update(id: string, data: UpdateRecordDto): Promise<Record>;
  delete(id: string): Promise<void>;
}

// Implementation
@Injectable()
export class RecordRepository implements IRecordRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateRecordDto): Promise<Record> {
    return this.prisma.record.create({
      data: {
        tableId: data.tableId,
        fields: data.fields,
      },
    });
  }

  // ... other methods
}

// Usage in Service
@Injectable()
export class RecordService {
  constructor(private recordRepository: RecordRepository) {}

  async createRecord(data: CreateRecordDto): Promise<Record> {
    // Business logic
    return this.recordRepository.create(data);
  }
}
```

### 4.2 Dependency Injection

```typescript
// NestJS built-in DI

@Module({
  providers: [
    RecordService,
    RecordRepository,
    {
      provide: 'DATABASE_CONNECTION',
      useFactory: (configService: ConfigService) => {
        return new PrismaService(configService);
      },
      inject: [ConfigService],
    },
  ],
})
export class RecordModule {}

// Using
@Injectable()
export class RecordService {
  constructor(
    private recordRepository: RecordRepository,
    @Inject('DATABASE_CONNECTION') private db: PrismaService,
  ) {}
}
```

### 4.3 Guard Pattern (Authorization)

```typescript
// Custom Guard
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private permissionService: PermissionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const baseId = request.params.baseId;

    return this.permissionService.hasAccess(user.id, baseId);
  }
}

// Usage on Controller
@Controller('bases/:baseId/records')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class RecordController {
  @Post()
  async createRecord(@Param('baseId') baseId: string) {
    // Only executed if guards pass
  }
}
```

### 4.4 Interceptor Pattern (Logging/Transformation)

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(() => {
        const time = Date.now() - now;
        console.log(`${request.method} ${request.url} - ${time}ms`);
      }),
      catchError((err) => {
        console.error(`Error in ${request.url}:`, err);
        throw err;
      }),
    );
  }
}

// Usage
@UseInterceptors(LoggingInterceptor)
@Controller('records')
export class RecordController {
  // All requests logged
}
```

### 4.5 Pipe Pattern (Validation/Transformation)

```typescript
@Injectable()
export class ParseUUIDPipe implements PipeTransform {
  transform(value: string): string {
    if (!isUUID(value)) {
      throw new BadRequestException(`${value} is not a valid UUID`);
    }
    return value;
  }
}

// Usage
@Get(':id')
async getRecord(@Param('id', ParseUUIDPipe) id: string) {
  return this.recordService.findById(id);
}
```

### 4.6 Strategy Pattern (Multiple implementations)

```typescript
// Abstract strategy
interface AuthStrategy {
  validate(token: string): Promise<User>;
}

// Implementations
@Injectable()
export class JwtStrategy implements AuthStrategy {
  async validate(token: string): Promise<User> {
    return this.jwtService.verify(token);
  }
}

@Injectable()
export class ApiKeyStrategy implements AuthStrategy {
  async validate(key: string): Promise<User> {
    return this.userService.findByApiKey(key);
  }
}

// Factory
@Injectable()
export class AuthFactory {
  constructor(
    private jwtStrategy: JwtStrategy,
    private apiKeyStrategy: ApiKeyStrategy,
  ) {}

  getStrategy(type: 'jwt' | 'api-key'): AuthStrategy {
    return type === 'jwt' ? this.jwtStrategy : this.apiKeyStrategy;
  }
}
```

---

## 5. Dépendances critiques

### 5.1 Dépendances principales

```
Frontend:
├── react@18.3.1
│   ├── react-dom@18.3.1
│   └── react-router-dom (navigation)
├── next@16.1.3
│   ├── server-side rendering
│   └── API routes
├── @tanstack/react-query@5.x
│   └── Server state management
├── zustand@4.x
│   └── Client state management
├── tailwindcss@3.4.1
│   └── Utility-first CSS
├── @radix-ui/* (UI primitives)
├── glide-data-grid (Advanced grid)
├── slate & plate.js (Rich text)
├── react-hook-form (Form management)
└── sharedb@4.1.2 (Collaboration)

Backend:
├── @nestjs/core@10.3.5
│   ├── @nestjs/common
│   ├── @nestjs/platform-express
│   └── @nestjs/websockets
├── prisma@6.2.1
│   ├── Database ORM
│   └── Schema management
├── @nestjs/passport (Authentication)
├── passport-jwt (JWT strategy)
├── class-validator (DTO validation)
├── zod (Schema validation)
├── bullmq (Job queue)
├── ioredis (Redis client)
├── pino (Logging)
├── aws-sdk (S3/MinIO)
└── nestjs-i18n (Translation)

Shared (Core):
├── @teable/core
│   ├── ANTLR4 (Formula parser)
│   ├── TQL (Query language)
│   └── Validators
├── zod (Schema validation)
├── typescript@5.4.3
└── tslib (TypeScript utilities)
```

### 5.2 Conflits et compatibilités

| Package | Version | Notes |
|---------|---------|-------|
| React | 18.3.1+ | Requires Node 18+ |
| TypeScript | 5.4+ | Strict mode enabled |
| Prisma | 6.2+ | Requires migration |
| NestJS | 10.3+ | Compatible with Node 22 |
| ShareDB | 4.1+ | WebSocket required |

---

## 6. Points d'intégration

### 6.1 Intégrations externes

```
Teable ├── OpenAI API (AI features)
       ├── GitHub OAuth (Authentication)
       ├── Google OAuth (Authentication)
       ├── Email Service (Notifications)
       ├── S3 / MinIO (File storage)
       ├── Sentry (Error tracking)
       ├── OpenTelemetry (Tracing)
       └── Webhooks (External integrations)
```

### 6.2 Extension via plugins

```typescript
// Plugin interface
interface Plugin {
  load(): Promise<void>;
  unload(): Promise<void>;
  registerMenuItems?(): MenuItemConfig[];
  registerComponents?(): ComponentConfig[];
  registerHooks?(): HookConfig[];
}

// Plugin lifecycle
1. Discovery (scan plugin directories)
2. Load (execute plugin.load())
3. Register (register extensions)
4. Activate (make available to users)
5. Unload (cleanup on deactivation)
```

### 6.3 Webhooks

```typescript
// Webhook event payload
{
  id: 'webhook-123',
  event: 'record.created',
  timestamp: '2025-02-05T10:00:00Z',
  data: {
    recordId: 'rec-456',
    tableId: 'tbl-789',
    fields: { name: 'John', email: 'john@example.com' },
    createdBy: 'user-123',
  },
  signatures: {
    'x-teable-signature': 'sha256=...',
  }
}
```

---

## 7. Analyse des modules

### 7.1 Module Backend: Authentication

**Fichier**: `apps/nestjs-backend/src/features/auth/`

**Flux**:
```
Login Request
  ↓
Validate credentials (bcrypt comparison)
  ↓
Generate JWT token (expires in 7 days)
  ↓
Generate Refresh token (expires in 30 days)
  ↓
Store refresh token in database
  ↓
Return tokens to client
  ↓
Client stores JWT in localStorage/cookie
  ↓
Client sends JWT in Authorization header
  ↓
Backend validates JWT on each request
```

**Stratégies**:
- Local (username/password)
- JWT (Bearer token)
- GitHub OAuth
- Google OAuth
- API Key

### 7.2 Module Backend: Record Management

**Fichier**: `apps/nestjs-backend/src/features/record/`

**Services**:
- `RecordService` - CRUD operations
- `RecordFieldService` - Field-specific operations
- `RecordValidationService` - Validation logic
- `RecordAggregationService` - Aggregation queries

**Key Operations**:
```typescript
// Create
POST /api/records { fields: {...} }

// Read
GET /api/records?filter=...&sort=...&skip=0&limit=100

// Update
PATCH /api/records/:id { fields: {...} }

// Delete (soft delete with Trash)
DELETE /api/records/:id

// Batch operations
POST /api/records/batch { operations: [...] }

// Undo/Redo
POST /api/records/:id/undo
POST /api/records/:id/redo
```

### 7.3 Module Backend: View Management

**Fichier**: `apps/nestjs-backend/src/features/view/`

**Types de vues**:
- Grid (table)
- Form (form entries)
- Kanban (card-based)
- Gallery (image grid)
- Calendar (date-based)

**Chaque vue supporte**:
- Custom field visibility (viewFields)
- Filtering (viewFilters)
- Sorting (viewSorts)
- Grouping (viewGroups)
- View-specific options (colors, dimensions, etc.)

### 7.4 Module Frontend: Grid Component

**Fichier**: `apps/nextjs-app/src/modules/grid/`

**Architecture**:
```
<GridContainer>
  ├─ <GridHeader>
  │   ├─ <FieldNameEditor>
  │   └─ <FieldOptionsMenu>
  ├─ <GridBody>
  │   └─ <VirtualizedGrid> (TanStack Virtual)
  │       └─ <Row>
  │           └─ <Cell>
  │               ├─ <TextInput>
  │               ├─ <DatePicker>
  │               ├─ <SelectDropdown>
  │               └─ ... (field-specific editors)
  ├─ <GridSidebar>
  │   ├─ <FilterPanel>
  │   ├─ <SortPanel>
  │   └─ <GroupPanel>
  └─ <GridFooter>
      └─ <PaginationControls>
```

**State Management**:
```typescript
// Zustand store
const gridStore = create((set) => ({
  selectedCells: [],
  filteredRecords: [],
  sortConfig: {},
  groupConfig: {},

  setSelectedCells: (cells) => set({ selectedCells: cells }),
  applyFilter: (filter) => set({ filteredRecords: [...] }),
  applySort: (sort) => set({ sortConfig: sort }),
  applyGroup: (group) => set({ groupConfig: group }),
}));
```

### 7.5 Module Frontend: Comment Thread

**Fichier**: `apps/nextjs-app/src/modules/comment/`

**Components**:
```
<CommentThread recordId="rec-123">
  ├─ <CommentList>
  │   └─ <CommentItem>
  │       ├─ <UserAvatar>
  │       ├─ <CommentText>
  │       ├─ <ReplyButton>
  │       └─ <Timestamp>
  │
  └─ <CommentInput>
      ├─ <RichTextEditor>
      │   └─ Mentions (@user)
      └─ <SubmitButton>
```

**Real-time Sync**:
```
User A writes comment
  ↓
POST /api/comments { recordId, text }
  ↓
Backend saves comment
  ↓
Emit WebSocket event: 'comment:created'
  ↓
All connected users receive event
  ↓
Re-render comment thread
  ↓
User B sees comment instantly
```

---

## Conclusion

Cette analyse détaillée fournit une vision complète de l'architecture de Teable. Comprendre ces patterns et flux est crucial pour:

1. **Contribuer efficacement** - Savoir où placer nouveau code
2. **Déboguer rapidement** - Suivre le flux de données
3. **Optimiser les performances** - Identifier les goulots d'étranglement
4. **Maintenir la qualité** - Respecter les patterns établis
5. **Scaler l'application** - Planifier les extensions

---

**Document de référence technique**
**Version**: 1.0
**Dernière mise à jour**: Février 2025
**Statut**: Complet et validé
