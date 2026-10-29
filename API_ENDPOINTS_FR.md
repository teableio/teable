# Documentation API Teable - Endpoints et Exemples

**Version**: 1.0
**Date**: Février 2025
**Base URL**: `http://localhost:3000/api/v1`

---

## 📋 Table des matières

1. [Authentification](#1-authentification)
2. [Espaces (Spaces)](#2-espaces-spaces)
3. [Bases (Bases)](#3-bases-bases)
4. [Tables](#4-tables)
5. [Champs (Fields)](#5-champs-fields)
6. [Vues (Views)](#6-vues-views)
7. [Enregistrements (Records)](#7-enregistrements-records)
8. [Commentaires](#8-commentaires)
9. [Partages](#9-partages)
10. [Pièces jointes](#10-pièces-jointes)
11. [Recherche et Filtrage](#11-recherche-et-filtrage)
12. [Codes d'erreur](#12-codes-derreur)

---

## 1. Authentification

### 1.1 Login avec email/password

**Endpoint**: `POST /auth/login`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

**Response** (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "refresh_token_here",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "name": "John Doe",
    "avatar": "https://..."
  }
}
```

### 1.2 Register

**Endpoint**: `POST /auth/register`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "password123",
    "name": "New User"
  }'
```

**Response** (201 Created):
```json
{
  "id": "user-456",
  "email": "newuser@example.com",
  "name": "New User",
  "createdAt": "2025-02-05T10:00:00Z"
}
```

### 1.3 Refresh Token

**Endpoint**: `POST /auth/refresh`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "refresh_token_here"
  }'
```

**Response** (200 OK):
```json
{
  "accessToken": "new_access_token...",
  "refreshToken": "new_refresh_token..."
}
```

### 1.4 Logout

**Endpoint**: `POST /auth/logout`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response** (200 OK):
```json
{
  "message": "Logged out successfully"
}
```

### 1.5 OAuth Login (GitHub)

**Endpoint**: `GET /auth/github`

**Redirection Flow**:
```
1. Client → GET /auth/github
2. Backend → Redirect to GitHub login page
3. GitHub → User authorizes app
4. GitHub → Redirect to /auth/github/callback
5. Backend → Create/update user, issue tokens
6. Backend → Redirect to frontend with tokens in URL
```

---

## 2. Espaces (Spaces)

### 2.1 Créer un espace

**Endpoint**: `POST /spaces`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/spaces \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Workspace",
    "description": "A collaborative workspace"
  }'
```

**Response** (201 Created):
```json
{
  "id": "space-123",
  "name": "My Workspace",
  "description": "A collaborative workspace",
  "ownerId": "user-123",
  "createdTime": "2025-02-05T10:00:00Z",
  "updatedTime": "2025-02-05T10:00:00Z"
}
```

### 2.2 Lister les espaces

**Endpoint**: `GET /spaces`

**Request**:
```bash
curl http://localhost:3000/api/v1/spaces \
  -H "Authorization: Bearer TOKEN"
```

**Query Parameters**:
```
?skip=0&limit=20&search=workspace
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "space-123",
      "name": "My Workspace",
      "description": "...",
      "ownerId": "user-123",
      "baseCount": 5,
      "collaborators": 3
    }
  ],
  "pagination": {
    "total": 10,
    "skip": 0,
    "limit": 20
  }
}
```

### 2.3 Récupérer un espace

**Endpoint**: `GET /spaces/:spaceId`

**Request**:
```bash
curl http://localhost:3000/api/v1/spaces/space-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "id": "space-123",
  "name": "My Workspace",
  "description": "...",
  "owner": { "id": "user-123", "name": "John" },
  "bases": [
    { "id": "base-1", "name": "CRM" },
    { "id": "base-2", "name": "Inventory" }
  ],
  "collaborators": [
    { "id": "user-456", "name": "Jane", "role": "editor" }
  ]
}
```

### 2.4 Mettre à jour un espace

**Endpoint**: `PATCH /spaces/:spaceId`

**Request**:
```bash
curl -X PATCH http://localhost:3000/api/v1/spaces/space-123 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Workspace",
    "description": "New description"
  }'
```

**Response** (200 OK):
```json
{
  "id": "space-123",
  "name": "Updated Workspace",
  "description": "New description",
  "updatedTime": "2025-02-05T11:00:00Z"
}
```

### 2.5 Supprimer un espace

**Endpoint**: `DELETE /spaces/:spaceId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/spaces/space-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

### 2.6 Inviter un collaborateur

**Endpoint**: `POST /spaces/:spaceId/invite`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/spaces/space-123/invite \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "role": "editor"
  }'
```

**Response** (200 OK):
```json
{
  "invitationId": "inv-123",
  "email": "newuser@example.com",
  "role": "editor",
  "expiresAt": "2025-02-12T10:00:00Z"
}
```

---

## 3. Bases (Bases)

### 3.1 Créer une base

**Endpoint**: `POST /spaces/:spaceId/bases`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/spaces/space-123/bases \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer CRM",
    "description": "Customer relationship management"
  }'
```

**Response** (201 Created):
```json
{
  "id": "base-456",
  "spaceId": "space-123",
  "name": "Customer CRM",
  "description": "Customer relationship management",
  "createdTime": "2025-02-05T10:00:00Z"
}
```

### 3.2 Lister les bases d'un espace

**Endpoint**: `GET /spaces/:spaceId/bases`

**Request**:
```bash
curl http://localhost:3000/api/v1/spaces/space-123/bases \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "base-1",
      "name": "CRM",
      "tableCount": 3,
      "updatedTime": "2025-02-05T10:00:00Z"
    }
  ]
}
```

### 3.3 Récupérer une base

**Endpoint**: `GET /bases/:baseId`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "id": "base-456",
  "name": "Customer CRM",
  "tables": [
    { "id": "tbl-1", "name": "Customers" },
    { "id": "tbl-2", "name": "Orders" }
  ],
  "owner": { "id": "user-123" },
  "collaborators": []
}
```

### 3.4 Mettre à jour une base

**Endpoint**: `PATCH /bases/:baseId`

**Request**:
```bash
curl -X PATCH http://localhost:3000/api/v1/bases/base-456 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated CRM",
    "description": "Updated description"
  }'
```

**Response** (200 OK):
```json
{
  "id": "base-456",
  "name": "Updated CRM",
  "description": "Updated description"
}
```

### 3.5 Supprimer une base

**Endpoint**: `DELETE /bases/:baseId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/bases/base-456 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

---

## 4. Tables

### 4.1 Créer une table

**Endpoint**: `POST /bases/:baseId/tables`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customers",
    "description": "Customer records"
  }'
```

**Response** (201 Created):
```json
{
  "id": "tbl-123",
  "baseId": "base-456",
  "name": "Customers",
  "description": "Customer records",
  "fields": [],
  "views": [],
  "createdTime": "2025-02-05T10:00:00Z"
}
```

### 4.2 Lister les tables

**Endpoint**: `GET /bases/:baseId/tables`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/tables \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "tbl-1",
      "name": "Customers",
      "fieldCount": 5,
      "recordCount": 150
    }
  ]
}
```

### 4.3 Récupérer une table

**Endpoint**: `GET /bases/:baseId/tables/:tableId`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/tables/tbl-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "id": "tbl-123",
  "name": "Customers",
  "fields": [
    {
      "id": "fld-1",
      "name": "Email",
      "type": "email",
      "required": true
    }
  ],
  "views": [
    { "id": "view-1", "name": "All Customers", "type": "grid" }
  ],
  "recordCount": 150
}
```

### 4.4 Supprimer une table

**Endpoint**: `DELETE /bases/:baseId/tables/:tableId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/bases/base-456/tables/tbl-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

---

## 5. Champs (Fields)

### 5.1 Créer un champ

**Endpoint**: `POST /bases/:baseId/tables/:tableId/fields`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/fields \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Email",
    "type": "email",
    "description": "Customer email",
    "required": true,
    "defaultValue": null
  }'
```

**Response** (201 Created):
```json
{
  "id": "fld-123",
  "tableId": "tbl-123",
  "name": "Email",
  "type": "email",
  "required": true,
  "createdTime": "2025-02-05T10:00:00Z"
}
```

### 5.2 Types de champs supportés

| Type | Description | Options |
|------|-------------|---------|
| `text` | Texte simple | maxLength, defaultValue |
| `email` | Adresse email | defaultValue |
| `number` | Nombre entier ou décimal | precision, scale, defaultValue |
| `date` | Date | format (YYYY-MM-DD) |
| `datetime` | Date et heure | format (YYYY-MM-DD HH:mm:ss) |
| `checkbox` | Booléen | defaultValue |
| `select` | Sélection simple | options: [{label, value, color}] |
| `multiSelect` | Sélection multiple | options: [{label, value, color}] |
| `attachment` | Fichiers | maxCount |
| `lookup` | Référence | linkedTableId, linkedFieldId |
| `formula` | Champ calculé | expression, resultType |
| `link` | Lien hypertexte | defaultValue |
| `phone` | Numéro de téléphone | defaultValue |
| `url` | URL | defaultValue |
| `richText` | Texte formaté | defaultValue |
| `rating` | Notation | max (1-5) |

### 5.3 Lister les champs

**Endpoint**: `GET /bases/:baseId/tables/:tableId/fields`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/fields \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "fld-1",
      "name": "Email",
      "type": "email",
      "required": true
    },
    {
      "id": "fld-2",
      "name": "Name",
      "type": "text",
      "required": true
    }
  ]
}
```

### 5.4 Mettre à jour un champ

**Endpoint**: `PATCH /bases/:baseId/tables/:tableId/fields/:fieldId`

**Request**:
```bash
curl -X PATCH http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/fields/fld-123 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Primary Email",
    "required": false
  }'
```

**Response** (200 OK):
```json
{
  "id": "fld-123",
  "name": "Primary Email",
  "type": "email",
  "required": false
}
```

### 5.5 Supprimer un champ

**Endpoint**: `DELETE /bases/:baseId/tables/:tableId/fields/:fieldId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/fields/fld-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

---

## 6. Vues (Views)

### 6.1 Créer une vue

**Endpoint**: `POST /bases/:baseId/tables/:tableId/views`

**Request - Grid View**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "All Customers",
    "type": "grid",
    "options": {
      "freezeColumns": 1,
      "rowHeight": "auto"
    }
  }'
```

**Request - Form View**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Add Customer",
    "type": "form",
    "options": {
      "layout": "single-column",
      "submitText": "Save Customer"
    }
  }'
```

**Request - Kanban View**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pipeline",
    "type": "kanban",
    "options": {
      "groupByField": "status",
      "cardFieldIds": ["fld-1", "fld-2"]
    }
  }'
```

**Request - Calendar View**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Events",
    "type": "calendar",
    "options": {
      "dateFieldId": "fld-date",
      "colorFieldId": "fld-category"
    }
  }'
```

**Response** (201 Created):
```json
{
  "id": "view-123",
  "tableId": "tbl-123",
  "name": "All Customers",
  "type": "grid",
  "createdTime": "2025-02-05T10:00:00Z"
}
```

### 6.2 Lister les vues

**Endpoint**: `GET /bases/:baseId/tables/:tableId/views`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "view-1",
      "name": "All Customers",
      "type": "grid"
    },
    {
      "id": "view-2",
      "name": "Pipeline",
      "type": "kanban"
    }
  ]
}
```

### 6.3 Mettre à jour une vue

**Endpoint**: `PATCH /bases/:baseId/tables/:tableId/views/:viewId`

**Request**:
```bash
curl -X PATCH http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views/view-123 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated View Name",
    "options": {
      "rowHeight": "tall"
    }
  }'
```

**Response** (200 OK):
```json
{
  "id": "view-123",
  "name": "Updated View Name",
  "type": "grid"
}
```

### 6.4 Appliquer un filtre à une vue

**Endpoint**: `POST /bases/:baseId/tables/:tableId/views/:viewId/filters`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views/view-123/filters \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fieldId": "fld-email",
    "operator": "contains",
    "value": "example.com"
  }'
```

**Opérateurs de filtre supportés**:
- `equals` - Égal à
- `notEquals` - Pas égal à
- `contains` - Contient
- `notContains` - Ne contient pas
- `startsWith` - Commence par
- `endsWith` - Se termine par
- `gt` - Plus grand que
- `gte` - Plus grand ou égal à
- `lt` - Moins que
- `lte` - Moins ou égal à
- `isEmpty` - Vide
- `isNotEmpty` - Pas vide

**Response** (201 Created):
```json
{
  "id": "filter-123",
  "viewId": "view-123",
  "fieldId": "fld-email",
  "operator": "contains",
  "value": "example.com"
}
```

### 6.5 Appliquer un tri à une vue

**Endpoint**: `POST /bases/:baseId/tables/:tableId/views/:viewId/sorts`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/views/view-123/sorts \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fieldId": "fld-name",
    "direction": "ascending",
    "priority": 1
  }'
```

**Response** (201 Created):
```json
{
  "id": "sort-123",
  "viewId": "view-123",
  "fieldId": "fld-name",
  "direction": "ascending",
  "priority": 1
}
```

---

## 7. Enregistrements (Records)

### 7.1 Créer un enregistrement

**Endpoint**: `POST /bases/:baseId/tables/:tableId/records`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "fld-name": "John Doe",
      "fld-email": "john@example.com",
      "fld-phone": "+33123456789",
      "fld-country": "France"
    }
  }'
```

**Response** (201 Created):
```json
{
  "id": "rec-123",
  "tableId": "tbl-123",
  "fields": {
    "fld-name": "John Doe",
    "fld-email": "john@example.com",
    "fld-phone": "+33123456789",
    "fld-country": "France"
  },
  "createdBy": "user-123",
  "createdTime": "2025-02-05T10:00:00Z"
}
```

### 7.2 Récupérer les enregistrements

**Endpoint**: `GET /bases/:baseId/tables/:tableId/records`

**Request**:
```bash
curl "http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records?skip=0&limit=50" \
  -H "Authorization: Bearer TOKEN"
```

**Query Parameters**:
```
?skip=0&limit=50&search=john&fieldIds=fld-1,fld-2
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "rec-1",
      "fields": {
        "fld-name": "John Doe",
        "fld-email": "john@example.com"
      },
      "createdTime": "2025-02-05T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "skip": 0,
    "limit": 50
  }
}
```

### 7.3 Récupérer un enregistrement

**Endpoint**: `GET /bases/:baseId/tables/:tableId/records/:recordId`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "id": "rec-123",
  "tableId": "tbl-123",
  "fields": {
    "fld-name": "John Doe",
    "fld-email": "john@example.com",
    "fld-phone": "+33123456789"
  },
  "createdBy": "user-123",
  "updatedBy": "user-123",
  "createdTime": "2025-02-05T10:00:00Z",
  "updatedTime": "2025-02-05T11:00:00Z"
}
```

### 7.4 Mettre à jour un enregistrement

**Endpoint**: `PATCH /bases/:baseId/tables/:tableId/records/:recordId`

**Request**:
```bash
curl -X PATCH http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "fld-email": "newemail@example.com",
      "fld-phone": "+33987654321"
    }
  }'
```

**Response** (200 OK):
```json
{
  "id": "rec-123",
  "fields": {
    "fld-name": "John Doe",
    "fld-email": "newemail@example.com",
    "fld-phone": "+33987654321"
  },
  "updatedTime": "2025-02-05T11:30:00Z"
}
```

### 7.5 Supprimer un enregistrement

**Endpoint**: `DELETE /bases/:baseId/tables/:tableId/records/:recordId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

### 7.6 Opérations en batch

**Endpoint**: `POST /bases/:baseId/tables/:tableId/records/batch`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/batch \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [
      {
        "type": "create",
        "fields": { "fld-name": "Jane Doe" }
      },
      {
        "type": "update",
        "recordId": "rec-456",
        "fields": { "fld-status": "active" }
      },
      {
        "type": "delete",
        "recordId": "rec-789"
      }
    ]
  }'
```

**Response** (200 OK):
```json
{
  "results": [
    { "type": "create", "recordId": "rec-999" },
    { "type": "update", "recordId": "rec-456" },
    { "type": "delete", "recordId": "rec-789" }
  ]
}
```

---

## 8. Commentaires

### 8.1 Créer un commentaire

**Endpoint**: `POST /bases/:baseId/tables/:tableId/records/:recordId/comments`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123/comments \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This customer needs follow-up",
    "mentions": ["user-456"]
  }'
```

**Response** (201 Created):
```json
{
  "id": "comment-123",
  "recordId": "rec-123",
  "text": "This customer needs follow-up",
  "author": {
    "id": "user-123",
    "name": "John",
    "avatar": "https://..."
  },
  "createdTime": "2025-02-05T10:00:00Z"
}
```

### 8.2 Lister les commentaires

**Endpoint**: `GET /bases/:baseId/tables/:tableId/records/:recordId/comments`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123/comments \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "comment-1",
      "text": "Follow up needed",
      "author": { "id": "user-123", "name": "John" },
      "createdTime": "2025-02-05T10:00:00Z"
    }
  ]
}
```

### 8.3 Mettre à jour un commentaire

**Endpoint**: `PATCH /bases/:baseId/tables/:tableId/records/:recordId/comments/:commentId`

**Request**:
```bash
curl -X PATCH http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123/comments/comment-123 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Updated comment text"
  }'
```

**Response** (200 OK):
```json
{
  "id": "comment-123",
  "text": "Updated comment text",
  "updatedTime": "2025-02-05T11:00:00Z"
}
```

### 8.4 Supprimer un commentaire

**Endpoint**: `DELETE /bases/:baseId/tables/:tableId/records/:recordId/comments/:commentId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123/comments/comment-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

---

## 9. Partages

### 9.1 Créer un partage public

**Endpoint**: `POST /bases/:baseId/shares`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/shares \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "view",
    "viewId": "view-123",
    "permissions": {
      "canRead": true,
      "canCreate": false,
      "canUpdate": false,
      "canDelete": false
    },
    "password": "optional-password"
  }'
```

**Response** (201 Created):
```json
{
  "id": "share-123",
  "baseId": "base-456",
  "token": "shareable-token-here",
  "url": "https://teable.io/share/shareable-token-here",
  "createdTime": "2025-02-05T10:00:00Z"
}
```

### 9.2 Lister les partages

**Endpoint**: `GET /bases/:baseId/shares`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/shares \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "share-1",
      "token": "token-123",
      "type": "view",
      "permissions": { "canRead": true },
      "createdTime": "2025-02-05T10:00:00Z"
    }
  ]
}
```

### 9.3 Révoquer un partage

**Endpoint**: `DELETE /bases/:baseId/shares/:shareId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/bases/base-456/shares/share-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

---

## 10. Pièces jointes

### 10.1 Upload de fichier

**Endpoint**: `POST /bases/:baseId/tables/:tableId/records/:recordId/attachments`

**Request**:
```bash
curl -X POST http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123/attachments \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@/path/to/file.pdf"
```

**Response** (201 Created):
```json
{
  "id": "att-123",
  "recordId": "rec-123",
  "filename": "document.pdf",
  "url": "https://storage.example.com/files/document.pdf",
  "size": 2048576,
  "mimeType": "application/pdf",
  "uploadedAt": "2025-02-05T10:00:00Z"
}
```

### 10.2 Lister les pièces jointes

**Endpoint**: `GET /bases/:baseId/tables/:tableId/records/:recordId/attachments`

**Request**:
```bash
curl http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123/attachments \
  -H "Authorization: Bearer TOKEN"
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "att-1",
      "filename": "invoice.pdf",
      "url": "https://storage.example.com/files/invoice.pdf",
      "size": 1024000
    }
  ]
}
```

### 10.3 Supprimer une pièce jointe

**Endpoint**: `DELETE /bases/:baseId/tables/:tableId/records/:recordId/attachments/:attachmentId`

**Request**:
```bash
curl -X DELETE http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/rec-123/attachments/att-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response** (204 No Content):
```
(empty body)
```

---

## 11. Recherche et Filtrage

### 11.1 Recherche textuelle

**Endpoint**: `GET /bases/:baseId/tables/:tableId/records?search=john`

**Request**:
```bash
curl "http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records?search=john" \
  -H "Authorization: Bearer TOKEN"
```

### 11.2 Filtrage avancé

**Endpoint**: `GET /bases/:baseId/tables/:tableId/records`

**Query Parameters**:
```
?filters=[
  {
    "fieldId": "fld-email",
    "operator": "contains",
    "value": "example.com"
  },
  {
    "fieldId": "fld-status",
    "operator": "equals",
    "value": "active"
  }
]&filterLogic=AND
```

### 11.3 Agrégations

**Endpoint**: `GET /bases/:baseId/tables/:tableId/records/aggregate`

**Request**:
```bash
curl -X GET "http://localhost:3000/api/v1/bases/base-456/tables/tbl-123/records/aggregate" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "aggregations": [
      {
        "fieldId": "fld-price",
        "operation": "SUM"
      },
      {
        "fieldId": "fld-category",
        "operation": "COUNT"
      }
    ],
    "groupBy": ["fld-category"]
  }'
```

**Opérations d'agrégation supportées**:
- `COUNT` - Nombre d'enregistrements
- `SUM` - Somme des valeurs
- `AVG` - Moyenne
- `MIN` - Valeur minimale
- `MAX` - Valeur maximale
- `DISTINCT_COUNT` - Nombre distinct

**Response** (200 OK):
```json
{
  "data": [
    {
      "group": { "fld-category": "Electronics" },
      "aggregations": {
        "price_sum": 50000,
        "count": 25
      }
    }
  ]
}
```

---

## 12. Codes d'erreur

### 12.1 Erreurs HTTP courantes

| Code | Message | Signification |
|------|---------|---------------|
| 200 | OK | Requête réussie |
| 201 | Created | Ressource créée |
| 204 | No Content | Suppression réussie |
| 400 | Bad Request | Requête invalide |
| 401 | Unauthorized | Authentification requise |
| 403 | Forbidden | Accès refusé |
| 404 | Not Found | Ressource non trouvée |
| 409 | Conflict | Conflit de version |
| 422 | Unprocessable Entity | Validation échouée |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Server Error | Erreur serveur |

### 12.2 Format d'erreur

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "details": [
    {
      "field": "email",
      "message": "email must be a valid email address"
    }
  ]
}
```

### 12.3 Exemples d'erreurs

**Authentification manquante**:
```json
{
  "statusCode": 401,
  "message": "Unauthorized - No token provided",
  "error": "Unauthorized"
}
```

**Permission insuffisante**:
```json
{
  "statusCode": 403,
  "message": "You don't have permission to access this resource",
  "error": "Forbidden"
}
```

**Validation échouée**:
```json
{
  "statusCode": 422,
  "message": "Validation failed",
  "error": "Unprocessable Entity",
  "details": [
    {
      "field": "email",
      "message": "email must be a valid email"
    },
    {
      "field": "password",
      "message": "password must be at least 8 characters"
    }
  ]
}
```

---

## Exemples complets

### Exemple 1: Créer une base complète avec tables et données

```bash
#!/bin/bash

TOKEN="your_access_token"
SPACE_ID="space-123"

# 1. Créer une base
BASE_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/v1/spaces/$SPACE_ID/bases" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Task Manager", "description": "Manage team tasks"}')

BASE_ID=$(echo $BASE_RESPONSE | jq -r '.id')
echo "Created base: $BASE_ID"

# 2. Créer une table
TABLE_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/v1/bases/$BASE_ID/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Tasks", "description": "Task list"}')

TABLE_ID=$(echo $TABLE_RESPONSE | jq -r '.id')
echo "Created table: $TABLE_ID"

# 3. Ajouter des champs
curl -s -X POST "http://localhost:3000/api/v1/bases/$BASE_ID/tables/$TABLE_ID/fields" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Title", "type": "text", "required": true}' > /dev/null

curl -s -X POST "http://localhost:3000/api/v1/bases/$BASE_ID/tables/$TABLE_ID/fields" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Status", "type": "select", "options": [{"label": "Todo"}, {"label": "In Progress"}, {"label": "Done"}]}' > /dev/null

# 4. Créer une vue
VIEW_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/v1/bases/$BASE_ID/tables/$TABLE_ID/views" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "All Tasks", "type": "grid"}')

VIEW_ID=$(echo $VIEW_RESPONSE | jq -r '.id')
echo "Created view: $VIEW_ID"

# 5. Ajouter des enregistrements
curl -s -X POST "http://localhost:3000/api/v1/bases/$BASE_ID/tables/$TABLE_ID/records" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"Title": "Design API", "Status": "In Progress"}}' > /dev/null

curl -s -X POST "http://localhost:3000/api/v1/bases/$BASE_ID/tables/$TABLE_ID/records" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"Title": "Implement endpoints", "Status": "Todo"}}' > /dev/null

echo "Setup complete!"
```

---

**Documentation API - Version 1.0**
**Date**: Février 2025
**Base URL**: http://localhost:3000/api/v1
