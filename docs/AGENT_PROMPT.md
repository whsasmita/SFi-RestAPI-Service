# 🤖 AGENT PROMPT & SPECIFICATION: SFi-admin-service

> **Instruction for AI Agent:** You are the primary backend engineer for `SFi-admin-service`. Read this document carefully before modifying code or answering questions about this repository.

---

## 1. Project Overview & System Context

`SFi-admin-service` is one of the **4 core repositories** in the **Semantic Flood Inventory System**:

```
[ Semantic Flood Inventory System ]
 ├── 1. Semantic-Flood-Inventory (Python NLP, NER, Geocoding & Ontology Engine)
 ├── 2. SFi-admin-service (YOU ARE HERE: REST API, MySQL DB, Ingestion, Staging, Validation, Triplification Trigger)
 ├── 3. SFi-graphql-service (GraphQL Gateway, GraphDB SPARQL Query Engine, Public Read API)
 └── 4. SFi-frontend (React 19 + Vite UI, Leaflet GIS Map, Visual Network Graph, Admin Dashboard)
```

### Purpose of this Service:
1. **Admin Authentication & Authorization:** Secure JWT-based access for system operators and researchers.
2. **News Ingestion & Staging:** Store raw Thai flood news articles and NLP-extracted entities (locations, impacts, times) in MySQL.
3. **Data Quality & Validation CMS:** Allow admins to review geocoded coordinates, approve/reject toponyms, and edit semantic roles (`FLOOD` vs `EVACUATION`).
4. **Publishing & Triplification:** Convert approved MySQL records into RDF Turtle format and publish them to GraphDB via REST API (`POST /repositories/{repo}/statements`).

---

## 2. Technology Stack

* **Runtime:** Node.js (v22+) - ES Modules (`"type": "module"`)
* **Framework:** Express.js (v4+)
* **Database:** MySQL (v8.0+) via `mysql2/promise` connection pool
* **Security:** JWT (`jsonwebtoken`), Password Hashing (`bcryptjs`), CORS
* **Integration:** Axios for GraphDB HTTP REST Communication

---

## 3. Database Schema (`semantic_flood_db`)

The database consists of 6 core tables:
1. **`users`**: Admin credentials (`id`, `username`, `email`, `password_hash`, `role`).
2. **`articles`**: Staged news articles (`id`, `title`, `title_th`, `title_en`, `url`, `source`, `publish_date`, `content_raw`, `content_summary_en`, `status`).
   * Status values: `'SCRAPED'`, `'PROCESSING'`, `'VALIDATED'`, `'PUBLISHED_TO_KG'`, `'REJECTED'`.
3. **`article_locations`**: Extracted location nodes with geocoding metadata (`node_id`, `text_th`, `text_en`, `admin_level`, `lat`, `lng`, `geocode_level`, `geocode_confidence`, `semantic_role`, `validation_status`).
4. **`article_impacts`**: Extracted damages & metrics (`impact_type`, `raw_expression`, `quantity_value`, `unit`).
5. **`article_times`**: Extracted temporal mentions (`time_expression`, `calendar_system`).
6. **`sync_logs`**: Audit trail of GraphDB publishing operations.

---

## 4. REST API Contracts

### A. Authentication (`/api/auth`)
* `POST /api/auth/register`: Create a new user (`username`, `email`, `password`, `role`).
* `POST /api/auth/login`: Authenticate and receive a JWT Bearer token.
* `GET /api/auth/me`: Get current logged-in user profile (Requires `Authorization: Bearer <token>`).

### B. Article Management (`/api/articles`)
* `GET /api/articles?status=SCRAPED&page=1&limit=20&search=HatYai`: List articles with pagination and filtering.
* `GET /api/articles/:id`: Get full article details including extracted locations, impacts, and times.
* `POST /api/articles`: Manually insert or import scraped articles.
* `PATCH /api/articles/locations/:locationId`: Update a location's validation status, semantic role (`FLOOD` or `EVACUATION`), or coordinates.

### C. Pipeline & GraphDB Publishing (`/api/pipeline`)
* `POST /api/pipeline/publish/:articleId`: Generates RDF Turtle triples for the validated article and posts them to GraphDB.
* `GET /api/pipeline/health`: Check MySQL and GraphDB connectivity and retrieve database statistics.

---

## 5. GraphDB Triplification Specification

When publishing an article, format the triples using standard predicates:
* Ontology Namespace: `http://example.org/ontology/flood#` (`flood:`)
* Resource Namespace: `http://example.org/resource/` (`res:`)
* Standard WGS84 Geo: `http://www.w3.org/2003/01/geo/wgs84_pos#` (`geo:`)
* RDFS Label: Every entity MUST have an `rdfs:label` triple so it renders cleanly in visual graphs.
* Relations:
  * Flood Occurrence: `event flood:hasLocation_Flood loc .` & `loc flood:isFloodLocationOf event .`
  * Evacuation / Shelter: `event flood:hasLocation_Evacuation loc .` & `loc flood:isEvacuationLocationOf event .`

---

## 6. How to Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables in .env
cp .env.example .env

# 3. Import MySQL schema
mysql -u root -p < database/schema.sql

# 4. Start service in development mode
npm run dev
```

---

## 7. Rules & Best Practices for Future Agents
1. **Do Not Store Plaintext Passwords:** Always use bcrypt with salt >= 10.
2. **Protect Admin Endpoints:** All routes under `/api/articles` and `/api/pipeline` must use `verifyToken` middleware.
3. **Preserve Geofence Rules:** Coordinates must stay within Thailand bounds ($5.61^\circ \le \text{Lat} \le 20.46^\circ$, $97.34^\circ \le \text{Lng} \le 105.64^\circ$) unless explicitly flagged as foreign.
4. **Keep Code Modular:** Maintain controllers, routes, middleware, and config cleanly separated.
