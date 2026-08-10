# PD Investigation Dashboard

An automated, high-performance investigation system that reconciles massive Invoice and REBNI datasets (1GB+ files) to identify discrepancies, trace shipment loops, and generate team communication blurbs in seconds.

**Created By:** Rohit Singh

---

## Key Features

- **High-Performance Stream Processing** — Custom 1MB read buffer streams gigabyte-sized TSV files from local or network drives in seconds
- **Consolidated Sellers** — Automatically merges related seller files (e.g., `Cocoblu` + `Cocoblu1`) into a single searchable dataset
- **In-Memory Caching** — FIFO cache with in-flight deduplication for instant repeated queries
- **Automated Investigation Rules** — Rule-based engine that detects discrepancies, checks REBNI availability (including cross-PO), and traces shipment loops
- **Loop Reconciliation Engine** — Breadth-first graph traversal across matched invoices to identify culprit invoices or confirm units missing from the original
- **SCR Invoice Handling** — Credit/debit notes (SCR suffix) are automatically normalized and traced to their base invoices
- **Non-Blocking Batch Scanner** — Worker Thread processes all invoice+ASIN pairs on a separate CPU thread with SSE progress streaming
- **Auto-Generated Blurbs** — Copy-paste-ready email templates with ASIN, PO, missing qty, cost price, and loop trace details
- **Modern UI** — Dark/light theme, responsive tables with filtering/sorting/pagination, inline investigation results
- **Desktop App** — Electron-based Windows installer, zero configuration needed

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Backend | Node.js (v16+) + Express 4.x (ES Modules) |
| Frontend | Vanilla HTML5, CSS3, JavaScript |
| Data | TSV streaming engine for local/network drives |
| Desktop | Electron 31.x + electron-builder (NSIS) |
| Concurrency | Worker Threads for batch processing |

```
Frontend (Browser/Electron)
    |
Express Server (port 3000)
    |
    +-- dataService.js        --> Stream & cache TSV files
    +-- investigationService.js --> Rule engine, blurb generation
    +-- reconciliationLoop.js  --> Shipment loop tracer (BFS)
    +-- batchWorker.js         --> Worker Thread for batch scan
    +-- investigationEngine.js --> Modular module coordinator
```

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v16 or higher

### Installation
```bash
npm install
```

### Launch Options

| Method | Command | Access |
|--------|---------|--------|
| Quick Start | Double-click `start.bat` | Auto-opens browser |
| Web Server | `npm start` | http://localhost:3000 |
| Electron Dev | `npm run electron-dev` | Desktop window |
| Build EXE | `npm run build-exe` | `dist/` installer |
| Network | `npm start` on host | http://HOST_IP:3000 |

---

## Data Directory

Default paths (auto-resolved per user):
```
C:\Users\<username>\Downloads\PD App\Invoice\*.txt
C:\Users\<username>\Downloads\PD App\REBNI\*.txt
```

Override in `.env`:
```env
INVOICE_DIR=\\your-network-path\Invoice
REBNI_DIR=\\your-network-path\REBNI
PORT=3000
```

---

## Investigation Workflow

### Phase 1: Data Ingestion
1. Select vendor code + seller files
2. System streams and filters TSV files in parallel
3. Returns filtered records + summary statistics
4. Batch scanner begins evaluating all pairs in background

### Phase 2: Deep Investigation
1. Enter Invoice Number + ASIN (or click "Run Audit" from batch table)
2. Engine runs rule-based analysis:
   - All INTERFACED/MATCHED → Resolved
   - ON_HOLD detected → Check REBNI availability → Trace loop
   - No REBNI match → Check cross-PO availability
   - Loop found → Trace all matched invoices (BFS) → Find culprit or confirm original
3. Generates professional email blurb with all details

### Investigation Rules

| Status | Action |
|--------|--------|
| All Interfaced/Matched | Request PQV update |
| ON_HOLD + REBNI Available | Suggest inventory utilization |
| ON_HOLD + Loop (cnt > 1) | Trace all hops, identify culprit |
| No REBNI at PO | Cross-PO REBNI availability check |
| Billed > Received | Generate discrepancy blurb |
| Loop: all hops OK | "Units missing from invoice: {original}" |

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/sellers | List available seller files |
| POST | /api/investigate | Start investigation (filter + load) |
| POST | /api/investigate/run | Run rules for Invoice + ASIN |
| GET | /api/investigate/batch-summary-stream | SSE batch scan (Worker Thread) |
| GET | /api/investigate/filters | Unique invoices/ASINs in session |
| GET | /api/investigate/rebni-filters | Warehouses/POs for ASIN |
| GET | /api/session | Restore active session |
| GET | /api/download/invoice | Export invoice CSV |
| GET | /api/download/rebni | Export REBNI CSV |
| GET | /api/cache | Cache statistics |
| DELETE | /api/cache | Clear cache |
| GET | /health | Server health check |

---

## Performance

| Metric | Value |
|--------|-------|
| File read (1.3GB, network) | 8-15 seconds |
| Cached query | 0ms (instant) |
| Single investigation | < 2 seconds |
| Batch scan (500 pairs) | 30-90 seconds (non-blocking) |
| Memory allocation | 8GB heap |
| Cache strategy | FIFO, max 4 entries |

---

## Project Structure

```
DashBoard/
  public/
    index.html          # UI layout
    app.js              # Frontend logic
    styles.css          # Design system (dark/light)
  server/
    server.js           # Express setup
    routes/
      api.js            # All API endpoints
    services/
      dataService.js    # TSV streaming + caching
      investigationService.js  # Rule engine + blurb generation
      batchWorker.js    # Worker Thread for batch scan
      investigation/
        investigationEngine.js  # Module coordinator
        reconciliationLoop.js   # Loop tracer (BFS)
        modules/
          invoiceStatusMatchModule.js  # Status + REBNI matching
  electron-main.js      # Electron entry point
  package.json
  .env                  # Path configuration
  start.bat             # Quick launch script
  DOCUMENTATION.md      # Full technical documentation
```

---

## Documentation

See [DOCUMENTATION.md](./DOCUMENTATION.md) for the full technical documentation including:
- Detailed decision tree flowchart
- Data column specifications (27 columns)
- Loop reconciliation algorithm details
- Time savings analysis (97% reduction)
- Deployment and configuration guide

---

*PD Investigation Dashboard v1.0.0 | Rohit Singh | 2026*
