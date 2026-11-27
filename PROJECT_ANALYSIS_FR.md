# Analyse du Projet Teable - Documentation Complète

**Version**: 1.10.0
**Date**: Février 2025
**Licence**: AGPL-3.0 (Community Edition) / Enterprise Edition disponible

---

## 📋 Table des matières

1. [Vue d'ensemble du projet](#1-vue-densemble-du-projet)
2. [Architecture globale](#2-architecture-globale)
3. [Structure du monorepo](#3-structure-du-monorepo)
4. [Stack technologique](#4-stack-technologique)
5. [Modules et composants clés](#5-modules-et-composants-clés)
6. [Base de données](#6-base-de-données)
7. [Flux de développement](#7-flux-de-développement)
8. [Guide de déploiement](#8-guide-de-déploiement)
9. [Guide de développement](#9-guide-de-développement)
10. [Intégrations et extensions](#10-intégrations-et-extensions)

---

## 1. Vue d'ensemble du projet

### 1.1 Qu'est-ce que Teable ?

Teable est une plateforme **no-code/low-code** qui fournit une interface de type feuille de calcul pour créer des applications de gestion de données puissantes. Elle permet aux utilisateurs de :

- **Gérer les données** de manière intuitive avec une interface spreadsheet-like
- **Collaborer en temps réel** avec leur équipe
- **Visualiser les données** selon plusieurs perspectives (Grid, Form, Kanban, Gallery, Calendar)
- **Automatiser les tâches** via des formules et plugins
- **Scaler à des millions de lignes** avec de vraies performances

### 1.2 Principes fondateurs

La vision de Teable repose sur 7 principes clés :

1. **Interface intuitive** - Interface spreadsheet familière accessible à tous
2. **Accès aux données ouvert** - Possibilité d'exporter/importer les données librement
3. **Vie privée des données** - Options cloud, on-premise, ou locale
4. **Adapté aux développeurs** - Code ouvert, extensible, standard en industrie
5. **Scalabilité** - Performance constante même avec des millions de lignes
6. **Flexibilité d'intégration** - Connecteurs multiples avec autres services
7. **IA native** - Intégration AI pour améliorer l'expérience utilisateur

### 1.3 Cas d'usage typiques

- **Gestion de projets** - Suivi des tâches, planning, ressources
- **CRM** - Gestion des clients et des opportunités
- **Gestion d'inventaire** - Suivi des stocks, commandes
- **Applications métier** - Collecte de données, reporting
- **Bases de connaissances** - Documentation collaborative
- **Automation** - Workflows et processus métier

---

## 2. Architecture globale

### 2.1 Diagramme d'architecture

```
┌─────────────────────────────────────────────────────────┐
│                  UTILISATEURS                            │
└─────────────────────────────────────────────────────────┘
                          │
                    HTTP/WebSocket
                          │
            ┌─────────────┴─────────────┐
            │                           │
     ┌──────▼──────┐          ┌────────▼────────┐
     │ FRONTEND    │          │ API REST/WS     │
     │ Next.js     │          │ NestJS Backend  │
     │ React       │          │ Port 3000       │
     └──────┬──────┘          └────────┬────────┘
            │                         │
            └──────────────┬──────────┘
                          │
            ┌─────────────┴──────────────┐
            │                            │
       ┌────▼─────┐         ┌──────────▼──────┐
       │ ShareDB  │         │ Prisma ORM      │
       │ (Real-   │         │ Schema Manager  │
       │  time)   │         └──────────┬──────┘
       └────┬─────┘                    │
            │          ┌───────────────┤
            │          │               │
       ┌────▼─┐  ┌──────▼──┐  ┌────────▼────┐
       │Redis │  │PostgreSQL│  │  MinIO      │
       │Cache │  │  Database│  │  S3 Storage │
       └──────┘  └──────────┘  └─────────────┘
```

### 2.2 Flux de données

1. **Requête utilisateur** → Frontend (Next.js)
2. **API Call** → Backend (NestJS)
3. **Validation + Logique métier** → Backend
4. **Sauvegarde** → Prisma → PostgreSQL
5. **Real-time sync** → ShareDB → Frontend
6. **Mise à jour UI** → React components

### 2.3 Couches applicatives

#### **Couche Présentation**
- Interface React avec Next.js
- Grid, Form, Kanban, Gallery, Calendar views
- Composants réutilisables (UI-lib)

#### **Couche Métier**
- Logique de validation
- Formules et calculs (ANTLR4 parser)
- Gestion des permissions
- Traitement des requêtes

#### **Couche Données**
- ORM Prisma
- Migrations de schéma
- Caching Redis
- Stockage de fichiers (MinIO)

---

## 3. Structure du monorepo

### 3.1 Vue générale

```
teable/
├── apps/                          # Applications
│   ├── nextjs-app/               # Frontend React
│   └── nestjs-backend/           # Backend API
│
├── packages/                      # Packages partagés
│   ├── core/                     # Logique métier, formules
│   ├── sdk/                      # SDK client pour intégrations
│   ├── ui-lib/                   # Composants UI réutilisables
│   ├── db-main-prisma/           # Schéma DB et migrations
│   ├── openapi/                  # Documentation API
│   ├── icons/                    # Icônes SVG
│   ├── common-i18n/              # Traductions/i18n
│   └── eslint-config-bases/      # Configuration ESLint
│
├── plugins/                       # Plugins extensibles
│
├── dockers/                       # Configuration Docker
├── scripts/                       # Scripts utilitaires
├── static/                        # Ressources statiques
└── Configuration files
```

### 3.2 Dépendances entre packages

```
nextjs-app (Frontend)
  ├── sdk (hooks, composants, client ShareDB)
  ├── core (types, formules, validators)
  ├── ui-lib (composants visuels)
  ├── icons (icônes)
  ├── openapi (types API)
  └── common-i18n (traductions)

nestjs-backend (API)
  ├── core (types, formules, validators)
  ├── db-main-prisma (schéma DB)
  ├── openapi (documentation API)
  └── common-i18n (traductions)

sdk
  ├── core
  ├── ui-lib
  ├── icons
  └── openapi

ui-lib
  ├── icons
  └── common-i18n
```

### 3.3 Stratégie de publication

| Package | Licence | Publié | NPM |
|---------|---------|--------|-----|
| core | MIT | ✓ | @teable/core |
| sdk | MIT | ✓ | @teable/sdk |
| ui-lib | MIT | ✓ | @teable/ui-lib |
| openapi | MIT | ✓ | @teable/openapi |
| icons | MIT | ✓ | @teable/icons |
| common-i18n | MIT | ✓ | @teable/common-i18n |
| db-main-prisma | - | ✗ | - |
| nestjs-backend | AGPL | ✗ | - |
| nextjs-app | AGPL | ✗ | - |

---

## 4. Stack technologique

### 4.1 Frontend

| Technologie | Version | Usage |
|-------------|---------|-------|
| **React** | 18.3.1 | Framework UI |
| **Next.js** | 16.1.3 | Framework fullstack |
| **TypeScript** | 5.4.3 | Langage de programmation |
| **Tailwind CSS** | 3.4.1 | Styling |
| **Radix UI** | Latest | Primitives UI |
| **TanStack Query** | 5.x | Gestion de cache/requêtes |
| **TanStack Table** | Latest | Grille de données avancée |
| **TanStack Virtual** | Latest | Virtualisation de listes |
| **Zustand** | Latest | State management |
| **ShareDB** | 4.1.2 | Collaboration real-time |
| **Plate.js** | Latest | Rich text editor |
| **ECharts** | Latest | Visualisation graphiques |
| **Recharts** | Latest | Graphiques React |
| **Glide Data Grid** | Latest | Grid composant |
| **FullCalendar** | Latest | Calendrier |
| **react-hook-form** | Latest | Gestion formulaires |
| **Zod** | Latest | Validation de schémas |

### 4.2 Backend

| Technologie | Version | Usage |
|-------------|---------|-------|
| **Node.js** | >= 22.0.0 | Runtime |
| **TypeScript** | 5.4.3 | Langage de programmation |
| **NestJS** | 10.3.5 | Framework backend |
| **Express.js** | Via NestJS | Serveur HTTP |
| **Prisma** | 6.2.1 | ORM et migrations |
| **PostgreSQL** | 12+ | Base de données principale |
| **SQLite** | 3+ | Mode développement |
| **Redis** | 6+ | Cache et sessions |
| **BullMQ** | Latest | Job queues |
| **Passport.js** | Latest | Authentification |
| **JWT** | Latest | Tokens d'authentification |
| **Pino** | Latest | Logging |
| **Zod** | Latest | Validation |
| **ANTLR4** | Latest | Parser formules |

### 4.3 DevOps & Infrastructure

| Technologie | Usage |
|-------------|-------|
| **Docker** | Containerisation |
| **Docker Compose** | Orchestration locale |
| **pnpm** 9.13.0 | Package manager |
| **GitHub Actions** | CI/CD |
| **MinIO** | S3-compatible storage |
| **Sentry** | Error tracking |
| **OpenTelemetry** | Observabilité |
| **Coveralls** | Coverage tracking |
| **Vitest** | Unit testing |
| **Playwright** | E2E testing |
| **ESLint** | Linting |
| **Prettier** | Code formatting |

### 4.4 Authentification & Sécurité

- **JWT** pour API authentication
- **Passport.js** avec stratégies multiples
  - Local (username/password)
  - OAuth (GitHub, Google)
  - Tokens d'accès API
- **CORS** configuré
- **Validation d'entrée** avec Zod
- **HTTPS** recommandé pour production

---

## 5. Modules et composants clés

### 5.1 Backend - Modules principaux

#### **Access Control Module** (`src/features/access`)
- Gestion des tokens d'accès
- API keys management
- Contrôle d'accès granulaire

#### **Authentication Module** (`src/features/auth`)
- JWT authentication
- OAuth integration (GitHub, Google)
- Session management
- Password hashing (bcrypt)

#### **Base Module** (`src/features/base`)
- Gestion des bases de données
- Créer, modifier, supprimer des bases
- Gestion des espaces (Space)
- Collaboration base-level

#### **Table Module** (`src/features/table`)
- Gestion des tables
- Métadonnées des tables
- Opérations CRUD table

#### **Field Module** (`src/features/field`)
- Définitions des types de champs
- Lookups et linked records
- Computed fields
- Field conversions

#### **View Module** (`src/features/view`)
- Gestionnaires de vues multiples
  - Grid View (tables classiques)
  - Form View (formulaires)
  - Kanban View (cards)
  - Gallery View (images)
  - Calendar View (événements)
- Configurations de vues (filtres, tris, groupes)

#### **Record Module** (`src/features/record`)
- Opérations CRUD enregistrements
- Batch operations
- Real-time updates via WebSocket

#### **Aggregation Module** (`src/features/aggregation`)
- Agrégations (SUM, COUNT, AVG, etc.)
- Calculs groupés
- Statistiques

#### **Comment Module** (`src/features/comment`)
- Comments sur enregistrements
- Mentions utilisateur
- Notifications de commentaires

#### **Attachment Module** (`src/features/attachment`)
- Upload de fichiers
- Gestion de stockage (MinIO)
- Preview fichiers

#### **Import/Export Module** (`src/features/import-export`)
- Import CSV/XLSX
- Export données
- Mapping de colonnes

#### **Share Module** (`src/features/share`)
- Public shares
- Share links
- Permission management

#### **Plugin Module** (`src/features/plugin`)
- Plugin management
- Plugin context menus
- Extension points

#### **AI Features Module** (`src/features/ai`)
- AI-powered features
- Multiple AI provider support
- Prompt management

#### **Notification Module** (`src/features/notification`)
- Email notifications
- Real-time notifications
- Notification preferences

#### **Undo/Redo Module** (`src/features/operation`)
- Opérations CRUD tracking
- Undo/Redo stack
- Collaboration support

### 5.2 Frontend - Composants principaux

#### **Layout Components**
- `<MainLayout>` - Layout principal
- `<SideBar>` - Navigation
- `<Header>` - Barre supérieure
- `<Footer>` - Pied de page

#### **View Components**
- `<GridView>` - Vue en grille
- `<FormView>` - Vue formulaire
- `<KanbanView>` - Vue kanban
- `<GalleryView>` - Vue galerie
- `<CalendarView>` - Vue calendrier

#### **Data Management Components**
- `<DataGrid>` - Composant de grille
- `<FieldEditor>` - Éditeur de champs
- `<FilterPanel>` - Filtrage de données
- `<SortPanel>` - Tri de données
- `<SearchBox>` - Recherche

#### **Collaboration Components**
- `<CommentThread>` - Fil de commentaires
- `<UserPresence>` - Indicateurs utilisateurs actifs
- `<ShareModal>` - Modal de partage
- `<HistoryPanel>` - Historique des modifications

#### **UI Primitives** (via ui-lib)
- `<Button>`
- `<Input>`
- `<Dialog>`
- `<Popover>`
- `<Menu>`
- `<Tabs>`
- `<Card>`

### 5.3 Packages partagés - Détails

#### **core** - Logique métier
```
src/
├── formula/          # Parser formules ANTLR4
├── tql/              # Query Language Parser
├── fields/           # Définitions types champs
├── validators/       # Logique de validation
├── utils/            # Utilitaires partagés
└── types/            # Types TypeScript
```

#### **sdk** - SDK client
```
src/
├── hooks/            # React hooks
├── components/       # Composants prêts à l'usage
├── client/           # ShareDB client
├── editor/           # Rich text editor
└── utils/            # Utilitaires
```

#### **ui-lib** - Composants UI
```
src/
├── components/       # Composants shadcn/ui
├── theme/            # Configuration Tailwind
├── storybook/        # Documentation composants
└── icons/            # Icônes intégrées
```

---

## 6. Base de données

### 6.1 Diagramme entités-relations

```
Space (Espace de travail)
  ├─→ Base (Projet/Base de données)
  │    ├─→ TableMeta (Définition de table)
  │    │    ├─→ Field (Colonne/Champ)
  │    │    │    ├─→ Computed Field
  │    │    │    └─→ Lookup Field
  │    │    ├─→ View (Vue - Grid/Form/Kanban/Gallery/Calendar)
  │    │    │    ├─→ ViewField (Configuration de colonne)
  │    │    │    ├─→ ViewSort (Tri)
  │    │    │    ├─→ ViewFilter (Filtre)
  │    │    │    └─→ ViewGroup (Groupage)
  │    │    └─→ Record (Enregistrement/Ligne)
  │    │         ├─→ Cell/Value (Cellule)
  │    │         ├─→ Comment (Commentaire)
  │    │         ├─→ Attachment (Pièce jointe)
  │    │         └─→ History (Historique)
  │    │
  │    ├─→ Share (Partages publics)
  │    └─→ Trash (Corbeille)
  │
  ├─→ User (Utilisateur)
  │    ├─→ Invitation (Invitations d'espace)
  │    └─→ Team (Équipe)
  │
  └─→ Collaborator (Contributeurs)
```

### 6.2 Schéma Prisma - Entités principales

#### **Space**
```typescript
model Space {
  id: String @id @default(uuid())
  name: String
  description: String?
  ownerId: String
  owner: User
  bases: Base[]
  collaborators: Collaborator[]
  createdTime: DateTime @default(now())
  updatedTime: DateTime @updatedAt
}
```

#### **Base**
```typescript
model Base {
  id: String @id @default(uuid())
  spaceId: String
  space: Space
  name: String
  description: String?
  owner: User
  tables: TableMeta[]
  shares: Share[]
  createdTime: DateTime @default(now())
  updatedTime: DateTime @updatedAt
}
```

#### **TableMeta**
```typescript
model TableMeta {
  id: String @id @default(uuid())
  baseId: String
  base: Base
  name: String
  description: String?
  fields: Field[]
  views: View[]
  records: Record[]
  icon: String?
  createdTime: DateTime @default(now())
  updatedTime: DateTime @updatedAt
}
```

#### **Field**
```typescript
model Field {
  id: String @id @default(uuid())
  tableId: String
  table: TableMeta
  name: String
  description: String?
  type: String  // text, number, date, select, lookup, etc.
  options: Json? // Configuration du type
  isComputed: Boolean @default(false)
  defaultValue: String?
  isRequired: Boolean @default(false)
  isLookupField: Boolean @default(false)
  lookupFieldId: String?  // For lookup fields
  createdTime: DateTime @default(now())
  updatedTime: DateTime @updatedAt
}
```

#### **View**
```typescript
model View {
  id: String @id @default(uuid())
  tableId: String
  table: TableMeta
  name: String
  type: String  // grid | form | kanban | gallery | calendar
  viewFields: ViewField[]
  viewFilters: ViewFilter[]
  viewSorts: ViewSort[]
  viewGroups: ViewGroup[]
  options: Json?  // Configuration spécifique au type de vue
  createdTime: DateTime @default(now())
  updatedTime: DateTime @updatedAt
}
```

#### **Record**
```typescript
model Record {
  id: String @id @default(uuid())
  tableId: String
  table: TableMeta
  fields: Json  // {fieldId: value, ...}
  comments: Comment[]
  attachments: Attachment[]
  history: RecordHistory[]
  createdBy: String
  updatedBy: String
  createdTime: DateTime @default(now())
  updatedTime: DateTime @updatedAt
}
```

#### **User**
```typescript
model User {
  id: String @id @default(uuid())
  email: String @unique
  name: String?
  password: String?
  avatar: String?
  oauthProviders: OAuthProvider[]
  spaces: Space[]  // Espaces possédés
  collaborations: Collaborator[]
  tokens: AccessToken[]
  createdTime: DateTime @default(now())
  updatedTime: DateTime @updatedAt
}
```

### 6.3 Stratégie de migration

- **Outil**: Prisma Migrations
- **Stockage**: `/packages/db-main-prisma/prisma/migrations`
- **Déclenchement**: Automatique au démarrage du backend
- **Versions DB supportées**:
  - PostgreSQL 12+
  - SQLite 3+ (dev only)

---

## 7. Flux de développement

### 7.1 Cycle de vie d'une feature

#### **Étape 1: Planification**
1. Créer une issue GitHub avec template feature
2. Assigner l'issue à un milestone
3. Créer une branche de feature: `feature/T-XXXX-description`

#### **Étape 2: Développement**
1. **Mettre à jour les types** (si schéma DB change)
   ```bash
   # Dans packages/db-main-prisma
   pnpm prisma migrate dev --name "description"
   ```

2. **Implémenter la logique métier**
   - Backend: Feature dans `apps/nestjs-backend/src/features/`
   - Frontend: Composants dans `apps/nextjs-app/src/components/`
   - Logique partagée: `packages/core/`

3. **Ajouter des tests**
   ```bash
   # Tests unitaires
   pnpm test

   # Tests E2E
   pnpm test:e2e
   ```

4. **Vérifier la qualité du code**
   ```bash
   # Linting
   pnpm g:lint

   # Type checking
   pnpm g:typecheck
   ```

#### **Étape 3: Review et Integration**
1. Créer une Pull Request
2. Les checks automatiques doivent passer:
   - Linting ✓
   - Type checking ✓
   - Unit tests ✓
   - Integration tests ✓
   - Build Docker ✓
3. Code review par au moins un maintainer
4. Merge dans la branche develop

#### **Étape 4: Release**
1. Créer un git tag: `v1.x.x`
2. GitHub Actions génère les images Docker
3. Deploy sur les serveurs

### 7.2 Structure de branching

```
main (production stable)
  ↑
  └─── develop (développement)
        └─── feature/T-XXXX-description
        └─── fix/T-XXXX-description
        └─── refactor/T-XXXX-description
```

### 7.3 Commit messages

Format: `[type]: description [ISSUE-ID]`

Types:
- `feat:` Nouvelle feature
- `fix:` Bug fix
- `refactor:` Refactoring
- `docs:` Documentation
- `style:` Formatting
- `test:` Tests
- `chore:` Dépendances, config

Exemple:
```
feat: add export to CSV functionality T1234
```

### 7.4 Pull Request template

```markdown
## Description
Brève description de ce qui a été changé et pourquoi.

## Type de changement
- [ ] Bug fix
- [ ] Nouvelle feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Décrire comment tester ces changements.

## Checklist
- [ ] Mon code suit les standards du projet
- [ ] J'ai exécuté les tests localement
- [ ] Les types TypeScript sont corrects
- [ ] La documentation est à jour
```

---

## 8. Guide de déploiement

### 8.1 Déploiement avec Docker

#### **Prérequis**
- Docker >= 20.10
- Docker Compose >= 2.0
- Node.js >= 22.0.0 (pour builds locales)

#### **Mode Standalone**
```bash
cd dockers/examples/standalone/
docker-compose up -d
```

Services:
- **Teable**: http://localhost:3000
- **PostgreSQL**: localhost:5432
- **MinIO**: http://localhost:9000

#### **Mode Développement**
```bash
# Terminal 1: Backend
cd apps/nestjs-backend
pnpm dev

# Terminal 2: Frontend (auto-lancé)
# Accessible sur http://localhost:3000
```

### 8.2 Configuration environnement

**Backend** (`apps/nestjs-backend/.env`)
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/teable

# Redis
REDIS_URL=redis://localhost:6379

# Storage
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=teable

# JWT
JWT_SECRET=your-secret-key

# Mail (optionnel)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your-email@gmail.com
MAIL_PASSWORD=your-password

# AI Providers (optionnel)
OPENAI_API_KEY=your-openai-key
```

**Frontend** (`apps/nextjs-app/.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_SHARE_DB_URL=ws://localhost:3000
```

### 8.3 Déploiement en production

#### **Plateforme Railway**
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/wada5e?referralCode=rE4BjB)

#### **Plateforme Sealos**
[![Deploy on Sealos](https://sealos.io/Deploy-on-Sealos.svg)](https://template.sealos.io/deploy?templateName=teable)

#### **Docker Compose Production**
```yaml
version: '3.8'
services:
  teable:
    image: teableio/teable:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/teable
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: password

  redis:
    image: redis:7
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 8.4 Monitoring et logging

- **Sentry**: Error tracking
- **OpenTelemetry**: Distributed tracing
- **Pino**: Structured logging

Configuration dans le backend:
```typescript
// src/config/sentry.ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

---

## 9. Guide de développement

### 9.1 Setup initial

```bash
# 1. Clone et installation
git clone https://github.com/teableio/teable.git
cd teable

# 2. Enable pnpm
corepack enable

# 3. Installer dépendances
pnpm install

# 4. Configure la base de données
make switch-db-mode
# Ou: pnpm run setup:db

# 5. Lancer le développement
cd apps/nestjs-backend
pnpm dev
```

### 9.2 Scripts de développement

```bash
# Depuis la racine du projet

# Development
pnpm dev                 # Lancer backend + frontend

# Building
pnpm g:build            # Construire tous les packages
pnpm build:packages     # Construire uniquement les packages

# Testing
pnpm g:test             # Lancer tous les tests
pnpm test:e2e           # Tests E2E Playwright
pnpm test:coverage      # Rapport de couverture

# Code Quality
pnpm g:lint             # ESLint sur tous les packages
pnpm g:typecheck        # Type checking TypeScript
pnpm format             # Prettier formatting

# Database
pnpm db:seed            # Seed la base avec données de test
pnpm db:reset           # Reset et seed la base
pnpm db:migrate         # Appliquer les migrations

# Dependencies
pnpm deps:check         # Vérifier dépendances outdated
pnpm deps:update        # Mettre à jour dépendances
```

### 9.3 Commandes Make

```bash
# Depuis la racine du projet
make dev                 # Lancer environnement développement
make docker.start       # Démarrer services Docker
make docker.stop        # Arrêter services Docker
make postgres.reset     # Reset PostgreSQL
make postgres.seed      # Seed PostgreSQL
make format             # Format code (Prettier)
make lint               # Lint code (ESLint)
```

### 9.4 Débogage

#### **Backend Debugging**
```bash
# Lancer avec node inspector
cd apps/nestjs-backend
node --inspect-brk ./dist/main.js

# Puis dans Chrome: chrome://inspect
```

#### **Frontend Debugging**
- Utiliser React DevTools
- Chrome DevTools
- VS Code debugger

### 9.5 Hot reload

- **Backend**: Nodemon récharge automatiquement
- **Frontend**: Next.js Fast Refresh

Fichiers modifiés → Compilation → Reload navigateur (en ~1-2s)

### 9.6 Tests

#### **Unit Tests**
```bash
# Lancer les tests
pnpm test

# Mode watch
pnpm test --watch

# Avec couverture
pnpm test --coverage
```

#### **E2E Tests**
```bash
# Lancer les tests E2E
pnpm test:e2e

# Mode debug UI
pnpm test:e2e --ui

# Headless browser
pnpm test:e2e --headed
```

#### **Test Structure**
```
__tests__/
├── unit/
│   ├── core/
│   ├── sdk/
│   └── ...
├── e2e/
│   ├── grid.spec.ts
│   ├── form.spec.ts
│   └── ...
└── fixtures/
```

---

## 10. Intégrations et extensions

### 10.1 Authentification OAuth

#### **GitHub OAuth**
```typescript
// Backend configuration
{
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: 'http://localhost:3000/auth/github/callback',
}
```

#### **Google OAuth**
```typescript
{
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://localhost:3000/auth/google/callback',
}
```

### 10.2 Système de plugins

#### **Structure d'un plugin**
```
my-plugin/
├── src/
│   ├── index.ts           # Entry point
│   ├── components/        # React components
│   ├── hooks/             # Custom hooks
│   └── types.ts           # TypeScript types
├── package.json
└── build/                 # Compiled output
```

#### **Exemple de plugin simple**
```typescript
// src/index.ts
import { Plugin } from '@teable/sdk';

export default class MyPlugin extends Plugin {
  async load() {
    // Plugin initialization
  }

  async unload() {
    // Plugin cleanup
  }

  registerMenuItems() {
    return [
      {
        label: 'My Action',
        action: () => {
          // Perform action
        }
      }
    ];
  }
}
```

### 10.3 API REST

#### **Authentification API**
```bash
# Générer une token API
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# Utiliser la token dans les requêtes
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/v1/spaces
```

#### **Exemples d'endpoints**

**Récupérer les bases**
```bash
GET /api/v1/spaces
Authorization: Bearer TOKEN
```

**Créer un enregistrement**
```bash
POST /api/v1/bases/{baseId}/tables/{tableId}/records
Content-Type: application/json
Authorization: Bearer TOKEN

{
  "fields": {
    "fieldId1": "value1",
    "fieldId2": "value2"
  }
}
```

**Mettre à jour un enregistrement**
```bash
PATCH /api/v1/bases/{baseId}/tables/{tableId}/records/{recordId}
Content-Type: application/json
Authorization: Bearer TOKEN

{
  "fields": {
    "fieldId1": "newValue"
  }
}
```

### 10.4 Webhooks

#### **Configuration des webhooks**
```typescript
// Via API
POST /api/v1/bases/{baseId}/webhooks
{
  "event": "record.created",
  "url": "https://your-api.com/webhook",
  "headers": {
    "Authorization": "Bearer YOUR_SECRET"
  }
}
```

#### **Événements supportés**
- `record.created` - Enregistrement créé
- `record.updated` - Enregistrement modifié
- `record.deleted` - Enregistrement supprimé
- `field.created` - Champ créé
- `field.updated` - Champ modifié
- `view.created` - Vue créée
- `view.updated` - Vue modifiée

### 10.5 Intégrations AI

Teable supporte plusieurs fournisseurs AI:

- **OpenAI** - GPT-4, GPT-3.5
- **Anthropic** - Claude
- **Hugging Face** - Modèles open-source
- **Custom** - Endpoints personnalisés

#### **Configuration**
```env
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Custom endpoint
CUSTOM_AI_ENDPOINT=https://your-api.com/ai
```

#### **Utilisation dans les formules**
```
AI_SUMMARY(text_field)
AI_CLASSIFY(text_field, ["category1", "category2"])
AI_TRANSLATE(text_field, "en", "fr")
```

### 10.6 Intégrations S3

Compatible S3 pour le stockage:

```env
# MinIO (S3-compatible)
MINIO_ENDPOINT=https://minio.your-domain.com
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET=teable-files

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_BUCKET=teable-files
```

---

## 11. Résolution des problèmes courants

### 11.1 Database connection errors

**Problème**: "Cannot connect to database"

**Solutions**:
1. Vérifier que PostgreSQL est lancé
   ```bash
   psql -h localhost -U postgres
   ```
2. Vérifier DATABASE_URL dans .env
3. Réinitialiser la base
   ```bash
   pnpm db:reset
   ```

### 11.2 Port already in use

**Problème**: "Address already in use :3000"

**Solutions**:
```bash
# Trouver le processus
lsof -i :3000

# Tuer le processus
kill -9 <PID>
```

### 11.3 Pnpm lock conflicts

**Problème**: "Cannot install dependencies - lock file conflict"

**Solutions**:
```bash
# Réinstaller les dépendances
rm -rf node_modules
pnpm install

# Ou updater pnpm-lock.yaml
pnpm install --force
```

### 11.4 TypeScript errors

**Problème**: "Type 'X' is not assignable to type 'Y'"

**Solutions**:
1. Vérifier les types
   ```bash
   pnpm g:typecheck
   ```
2. Lancer typescript compiler
   ```bash
   tsc --noEmit
   ```
3. Vérifier les imports

### 11.5 Real-time sync issues

**Problème**: "Changes not syncing in real-time"

**Solutions**:
1. Vérifier Redis est lancé
2. Vérifier les logs WebSocket
3. Vérifier la configuration ShareDB

---

## 12. Performance et optimisation

### 12.1 Frontend Optimization

- **Code Splitting**: Next.js dynamic imports
- **Image Optimization**: next/image pour optimisation auto
- **Lazy Loading**: TanStack Virtual pour grandes listes
- **Caching**: React Query avec stale-while-revalidate
- **Bundle Size**: Analyser avec `npm run analyze`

### 12.2 Backend Optimization

- **Database Indexing**: Créer les bonnes indexes
- **Query Optimization**: Éviter les N+1 queries
- **Caching**: Redis pour données fréquentes
- **Job Queue**: BullMQ pour tâches async
- **Compression**: gzip middleware activé

### 12.3 Database Optimization

```sql
-- Créer un index sur champ fréquemment filtré
CREATE INDEX idx_table_user_id ON "TableMeta"("userId");

-- Analyser les performances de requête
EXPLAIN ANALYZE SELECT * FROM "Record" WHERE tableId = '...';
```

---

## 13. Statistiques du projet

| Métrique | Valeur |
|----------|--------|
| **Version** | 1.10.0 |
| **License** | AGPL-3.0 |
| **Langage principal** | TypeScript |
| **Node.js minimum** | 22.0.0 |
| **Packages** | 8 (partagés) |
| **Applications** | 2 (frontend + backend) |
| **Repositories** | GitHub (public) |
| **Tests** | Unit + E2E |
| **CI/CD** | GitHub Actions |
| **Code coverage** | Via Coveralls |

---

## 14. Ressources et liens

### Documentations officielles
- [Teable Documentation](https://help.teable.ai)
- [API Documentation](https://help.teable.ai/en/api-doc/token)
- [GitHub Repository](https://github.com/teableio/teable)
- [Discord Community](https://discord.gg/uZwp7tDE5W)

### Technologies
- [NestJS Docs](https://docs.nestjs.com)
- [Next.js Docs](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [React Docs](https://react.dev)
- [TypeScript Docs](https://www.typescriptlang.org/docs)

### Outils
- [pnpm](https://pnpm.io)
- [Vitest](https://vitest.dev)
- [Playwright](https://playwright.dev)
- [Docker](https://docs.docker.com)

---

## 15. Contribuer au projet

### 15.1 Code of Conduct
Voir [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

### 15.2 Contributing Guidelines
Voir [CONTRIBUTING.md](./CONTRIBUTING.md)

### 15.3 Étapes pour contribuer

1. **Fork** le repository
2. **Clone** votre fork
3. **Créer une branche** de feature
4. **Faire vos changements**
5. **Tester** vos changements
6. **Commit** avec messages descriptifs
7. **Push** sur votre fork
8. **Créer une Pull Request**

---

## Conclusion

Teable est un projet ambitieux qui combine une expérience utilisateur intuitive avec une architecture technique robuste. Sa structure en monorepo facilite le développement, le testing, et le déploiement. Que vous soyez contributeur, développeur d'extension, ou utilisateur advanced, cette documentation devrait vous fournir les bases nécessaires pour naviguer efficacement dans le projet.

Pour des questions spécifiques ou une assistance supplémentaire, n'hésitez pas à rejoindre la communauté Discord ou ouvrir une issue sur GitHub.

---

**Dernière mise à jour**: Février 2025
**Version de Teable analysée**: 1.10.0
**Statut**: Documentation en cours de maintenance
