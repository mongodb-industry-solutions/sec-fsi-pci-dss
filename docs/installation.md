
## 🚀 Quick Start

### ✅ Prerequisites

- Node.js 20+
- Docker + Docker Compose
- MongoDB Atlas cluster (M10 or higher: free tier does not support QE)
- AWS KMS key (or set `KMS_PROVIDER=local` for local development)

### 1️⃣ Configure Environment

```bash
cp .env.example .env
# Edit .env: set MONGODB_URI, AWS_CMK_ARN, and AWS credentials
# For offline/local mode: set KMS_PROVIDER=local
```

### 2️⃣ Install Dependencies

```bash
npm run install:all
# Installs root + frontend + backend dependencies
```

### 3️⃣ Set Up the Database

```bash
npm run setup:db   # Creates collections, QE schemas, key vault, indexes
npm run seed       # Inserts synthetic BIAN-compliant demo data
```

### 4️⃣ Start the Application

```bash
# Option A: Docker Compose (recommended)
npm run docker:up

# Option B: Development mode with hot reload
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the demo.

---

## 🛠️ Available Commands

| Command | Description |
|---|---|
| `npm run install:all` | Install root + frontend + backend dependencies |
| `npm run dev` | Start frontend and backend concurrently (hot reload) |
| `npm run dev:frontend` | Start only the Next.js frontend |
| `npm run dev:backend` | Start only the Fastify API |
| `npm run build` | Build frontend and backend for production |
| `npm run setup:db` | Create collections, indexes, and QE key vault |
| `npm run seed` | Insert synthetic demo data (idempotent) |
| `npm run docker:up` | Build and start full stack with Docker Compose |
| `npm run docker:down` | Stop and remove containers |
| `npm run docker:logs` | Tail container logs |
