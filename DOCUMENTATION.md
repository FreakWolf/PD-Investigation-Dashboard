# PD Investigation Dashboard
## Automation Documentation

**Author:** Rohit Singh  
**Version:** 1.0.0  
**Date:** August 2026  

---

## 1. Executive Summary

The PD Investigation Dashboard is an automated system designed to reconcile Invoice and REBNI (Receiving & Billing Non-Invoiced) datasets at scale. It replaces the manual process of cross-referencing large TSV files (1GB+) to identify discrepancies in billed vs. received quantities, locate missing units across shipment loops, and generate standardized communication blurbs for team escalation.

**Key Outcomes:**
- Reduces investigation time from 30-45 minutes per case to under 30 seconds
- Processes 20,000+ invoice records and 15,000+ REBNI records simultaneously
- Automatically traces multi-invoice shipment loops to identify culprit invoices
- Generates copy-paste-ready email templates for team communication
- Runs as a standalone desktop application requiring zero configuration

---

## 2. Problem Statement

Investigators handling PD (Price Difference) claims must:
1. Download large Invoice and REBNI text files (often exceeding 1GB each)
2. Filter records by vendor code manually
3. Cross-reference invoice quantities against REBNI receiving data
4. Identify discrepancies (billed vs. received mismatches)
5. Trace complex shipment loops where units are matched across multiple invoices
6. Check for available REBNI inventory that could resolve the discrepancy
7. Draft investigation summary emails with specific details (ASIN, PO, missing qty, cost price)

This manual process is error-prone, time-consuming, and scales poorly with increasing vendor data volumes.

---

## 3. Solution Architecture

### 3.1 Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend | Node.js v22 + Express 4.x | REST API server, data processing |
| Frontend | Vanilla HTML5, CSS3, JavaScript | User interface, real-time updates |
| Desktop | Electron 31.x | Standalone Windows application |
| Data I/O | Custom TSV streaming engine | High-performance file reading |
| Concurrency | Worker Threads | Non-blocking batch processing |
| Build | electron-builder (NSIS) | Windows installer generation |

### 3.2 System Architecture

```
+------------------------------------------------------------------+
|                    Electron Desktop Application                    |
|  +------------------------------------------------------------+  |
|  |                  Browser Window (Chromium)                   |  |
|  |  +-------------------------------------------------------+ |  |
|  |  |              Frontend (HTML/CSS/JS)                     | |  |
|  |  |  - Investigation Setup Form                            | |  |
|  |  |  - Batch Investigation Scanner                         | |  |
|  |  |  - Invoice & REBNI Data Tables                         | |  |
|  |  |  - Investigation Results (Timeline, Blurb, Metrics)    | |  |
|  |  +-------------------------------------------------------+ |  |
|  +------------------------------------------------------------+  |
|                              |                                    |
|                        HTTP (localhost)                            |
|                              |                                    |
|  +------------------------------------------------------------+  |
|  |                  Express Backend Server                      |  |
|  |  +------------------+  +--------------------------------+  |  |
|  |  | API Routes       |  | Investigation Service          |  |  |
|  |  | (api.js)         |  | (investigationService.js)      |  |  |
|  |  +------------------+  +--------------------------------+  |  |
|  |  +------------------+  +--------------------------------+  |  |
|  |  | Data Service     |  | Reconciliation Loop Engine     |  |  |
|  |  | (dataService.js) |  | (reconciliationLoop.js)        |  |  |
|  |  +------------------+  +--------------------------------+  |  |
|  |  +------------------+  +--------------------------------+  |  |
|  |  | Worker Thread    |  | Investigation Engine           |  |  |
|  |  | (batchWorker.js) |  | (investigationEngine.js)       |  |  |
|  |  +------------------+  +--------------------------------+  |  |
|  +------------------------------------------------------------+  |
|                              |                                    |
+------------------------------------------------------------------+
                               |
                    Local/Network File System
                               |
              +----------------+----------------+
              |                                 |
     Invoice TSV Files                 REBNI TSV Files
     (1GB+ per seller)                 (1GB+ per seller)
```

---

## 4. Features & Capabilities

### 4.1 Data Ingestion (Phase 1)

| Feature | Description |
|---------|-------------|
| Consolidated Sellers | Automatically merges related seller files (e.g., `Cocoblu` + `Cocoblu1`) into a single searchable dataset |
| Stream Processing | Custom 1MB read buffer for efficient streaming from network drives |
| In-Memory Cache | FIFO cache (max 4 entries) for instant repeated queries |
| In-Flight Deduplication | Concurrent identical requests share the same Promise |
| Smart Path Resolution | Automatically detects user's Downloads folder, supports UNC network paths |
| Vendor Filtering | Fast pre-split vendor_code column check before full line parsing |

### 4.2 Automated Investigation (Phase 2)

The investigation engine evaluates each Invoice + ASIN pair through a rule-based decision tree:

```
Start Investigation
       |
       v
[Rule 1] All statuses INTERFACED/AUTHORIZED/MATCHED?
       |                    |
      YES                  NO
       |                    |
       v                    v
  "Resolved -         [Rule 2] Any ON_HOLD status?
   Fully Processed"        |                |
                          YES              NO
                           |                |
                           v                v
                  Check REBNI         Match REBNI by
                  Availability        PO + ASIN + Warehouse
                       |                    |
                       v                    v
              [Available?]          [cnt_invoice_matched]
               /        \                /    |     \
             YES         NO            1    >1      0
              |           |            |     |      |
              v           v            v     v      v
        "REBNI        Check Loop    Verify  Loop   "Unmatched"
         Available"   Reconciliation Match  Check
                           |            |
                           v            v
                    Trace ALL       Compare Billed
                    matched         vs Received
                    invoices            |
                       |                v
                       v         [Discrepancy?]
              [Found culprit?]    /         \
               /           \   YES          NO
             YES            NO  |            |
              |              |  v            v
              v              v "Discrepancy" "Matched"
        "Loop          "Units missing
         Discrepancy    from original
         Found"         invoice"
```

### 4.3 Investigation Rules Detail

| Rule | Trigger Condition | Output |
|------|-------------------|--------|
| Fully Processed | All rows: INTERFACED/AUTHORIZED/MATCHED | Blurb requesting PQV update |
| ON_HOLD Discrepancy | ON_HOLD status with billed > received | Missing qty blurb with ASIN/CP details |
| REBNI Available | rebni_available > 0 at same warehouse within 30 days | Blurb suggesting inventory utilization |
| Cross-PO REBNI | No REBNI at current PO, but available at another PO | Same warehouse REBNI suggestion |
| Loop Reconciliation | cnt_invoice_matched > 1 | Traces all matched invoices to find culprit |
| No Discrepancy in Loop | All loop hops show received >= billed | Points to original invoice as source |
| Invoice Mismatch | REBNI matched to different invoice | Flags for manual review |

### 4.4 Loop Reconciliation Engine

The reconciliation loop uses a **breadth-first graph traversal** algorithm:

1. Start at the claiming invoice
2. Look up REBNI records for the invoice's PO + ASIN
3. Extract `matched_invoice_numbers` from the REBNI record
4. For each matched invoice (stripping SCR suffixes for credit notes):
   - Find the target invoice in the dataset
   - Calculate `linkQty` from `shipmentwise_matched_qty` at the position matching the source PO
   - Check if `billed > received` at the target (discrepancy)
   - If no discrepancy, follow that invoice's REBNI to the next hop
5. Continue until:
   - A discrepancy is found (culprit identified)
   - REBNI available inventory is found (suggest utilization)
   - All paths exhausted (units missing from original invoice)

**SCR Handling:** Credit/debit note invoices (suffixed with SCR, SCRSCR, etc.) are:
- Never traced as independent hops
- Stripped to their base invoice for tracing
- Used to derive the `linkQty` that connects invoices

### 4.5 Batch Investigation Scanner

The batch scanner evaluates ALL unique (invoice, ASIN) pairs in a loaded dataset:

- Runs in a **dedicated Worker Thread** to avoid blocking the UI
- Streams results progressively via Server-Sent Events (SSE)
- Processes in chunks of 5 pairs per message
- Shows real-time progress bar (X / N pairs scanned)
- Application remains fully responsive during scanning

### 4.6 Generated Communication Blurbs

The system auto-generates professional email templates based on investigation outcome:

**Discrepancy Template:**
```
Hello Team,

-- Kindly find the below mentioned ASIN's missing from PO# : {PO}

        ASIN       Missing QTY    CP
{ASIN}             {missing}      {cost_price}

For ASIN: {ASIN}
Billed: {billed}, Received: {received}
Matched: {matched_invoice_numbers}

Upon Checking Invoice: {hop_invoice}
{link_qty} units matched to PO: {hop_po} and ASIN: {hop_asin}
Billed: {hop_billed}, Received: {hop_received}
__

Units missing from invoice: {original_invoice}

Kindly investigate the following invoices and ASINs for missing units:

Invoice: {culprit_invoice}
ASIN: {culprit_asin}

Please check and help locate the missing units against the above invoices.

Regards.
```

---

## 5. Data Specifications

### 5.1 Invoice TSV Columns (13)

| Column | Description |
|--------|-------------|
| vendor_code | Vendor identifier for filtering |
| purchase_order_id | PO number |
| asin | Amazon Standard Identification Number |
| invoice_number | Invoice reference (may have SCR suffix for credit notes) |
| invoice_date | Date of invoice |
| invoice_item_status | INTERFACED, AUTHORIZED, MATCHED, ON_HOLD, SUBMITTED |
| quantity_invoiced | Total units billed |
| quantity_matched | Units matched/received |
| no_of_shipments | Number of shipments for this line |
| shipment_id | Shipment reference(s), comma-separated |
| shipmentwise_matched_qty | Matched qty per shipment, comma-separated |
| matched_po | PO(s) matched to, comma-separated |
| matched_asin | ASIN(s) matched to, comma-separated |

### 5.2 REBNI TSV Columns (14)

| Column | Description |
|--------|-------------|
| vendor_code | Vendor identifier for filtering |
| po | Purchase Order number |
| asin | Amazon Standard Identification Number |
| shipment_id | Shipment reference |
| received_datetime | Date/time of receiving |
| warehouse_id | Fulfillment Center code (e.g., HBX1, BLR4) |
| item_cost | Unit cost price |
| quantity_unpacked | Units unpacked at warehouse |
| quantity_adjusted | Adjustment quantity |
| qty_received_postadj | Final received after adjustment |
| quantity_matched | Units matched to invoices |
| rebni_available | Available unmatched REBNI inventory |
| cnt_invoice_matched | Number of invoices matched to this REBNI |
| matched_invoice_numbers | Invoice number(s) matched, comma/space separated |

---

## 6. Performance Optimizations

| Optimization | Impact |
|--------------|--------|
| 1MB stream buffer (highWaterMark) | Reduces network round-trips from ~20,000 to ~1,300 for 1.3GB file |
| 8GB Node.js heap allocation | Prevents OOM on large datasets |
| Pre-split vendor_code check | Skips full line parsing for non-matching rows |
| FIFO cache (max 4 entries) | Instant 0ms response for repeated queries |
| In-flight deduplication | Prevents redundant file reads from concurrent requests |
| Worker Thread batch processing | Zero UI blocking during batch scan |
| Server-Sent Events streaming | Progressive results without long-blocking requests |
| REBNI index by asin+po | O(1) lookup during batch evaluation |
| String copy forcing | Prevents memory retention of readline buffers |

---

## 7. API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/sellers | List available Invoice/REBNI seller files |
| POST | /api/investigate | Start investigation (filter + load data) |
| POST | /api/investigate/run | Run rules for specific Invoice + ASIN |
| GET | /api/investigate/filters | Get unique invoices/ASINs from session |
| GET | /api/investigate/rebni-filters | Get warehouses/POs for an ASIN |
| GET | /api/investigate/batch-summary | Synchronous batch scan (legacy) |
| GET | /api/investigate/batch-summary-stream | SSE streaming batch scan (Worker Thread) |
| GET | /api/session | Restore active investigation state |
| GET | /api/download/invoice | Export filtered invoice data as CSV |
| GET | /api/download/rebni | Export filtered REBNI data as CSV |
| GET | /api/cache | View cache statistics |
| DELETE | /api/cache | Clear in-memory cache |
| GET | /health | Server health check |

---

## 8. User Interface

### 8.1 Layout

The dashboard is organized into functional sections:

1. **Header** — Application title, author credit, live clock, dark/light theme toggle
2. **Investigation Setup** (left panel) — Vendor code input, seller file selection, and investigation engine form (Invoice Number, ASIN, optional overrides for Missing QTY, CP, Warehouse, etc.)
3. **Investigation Summary** (right panel) — Statistics (record counts, unique ASINs/POs/shipments) and inline investigation results (ASIN tabs, metrics, timeline, generated blurb)
4. **Batch Investigation Scanner** — Auto-scans all invoice+ASIN pairs with progressive loading
5. **Invoice Analysis Table** — Filterable, sortable, paginated table of all invoice records
6. **REBNI Analysis Table** — Filterable, sortable, paginated table of all REBNI records

### 8.2 Design System

- **Typography:** Inter (UI) + JetBrains Mono (data/code)
- **Theme:** Dark mode (default) with light mode toggle
- **Components:** Cards, progress bars, status pills, metric highlights
- **Responsive:** Adapts from 1440px desktop to smaller viewports

---

## 9. Deployment Options

### 9.1 Standalone Desktop (Recommended)

```
npm install
npm run build-exe
```
Produces: `dist/PD Investigation Dashboard Setup 1.0.0.exe`  
One-click NSIS installer for Windows. No additional setup required.

### 9.2 Local Web Server

```
npm install
npm start
```
Accessible at `http://localhost:3000`

### 9.3 Network Deployment

1. Run `npm start` on host machine
2. Find host IP: `ipconfig`
3. Configure Windows Firewall for port 3000
4. Team accesses at `http://<HOST_IP>:3000`

---

## 10. Configuration

The `.env` file (auto-configured, no manual editing needed):

```
INVOICE_DIR=C:\Users\<Current-User>\Downloads\PD App\Invoice
REBNI_DIR=C:\Users\<Current-User>\Downloads\PD App\REBNI
PORT=3000
```

- `<Current-User>` is automatically resolved at runtime
- Supports UNC network paths: `\\server\share\Invoice`
- Electron mode auto-detects the user's true Downloads folder

---

## 11. Time Savings Analysis

| Task | Manual Process | Automated | Savings |
|------|---------------|-----------|---------|
| Filter vendor data from 1GB file | 2-5 minutes | 8-15 seconds | 90%+ |
| Cross-reference Invoice vs REBNI | 10-15 minutes | Instant | 99% |
| Trace shipment loop (3+ hops) | 15-20 minutes | 2-3 seconds | 99% |
| Generate investigation email | 5-10 minutes | Instant (auto-generated) | 100% |
| Batch scan all ASINs for a vendor | 2-4 hours | 30-90 seconds | 98% |
| **Total per investigation** | **30-45 minutes** | **< 30 seconds** | **97%** |

---

## 12. Future Enhancements (Planned)

- Multi-user session support with user isolation
- Investigation history and audit trail
- Direct integration with ticketing systems
- Automated daily batch scanning with email alerts
- Machine learning for discrepancy pattern detection

---

## 13. Repository

**GitHub:** https://github.com/FreakWolf/PD-Investigation-Dashboard  
**Branch:** main  
**License:** Internal use only

---

*Document prepared by Rohit Singh | PD Investigation Dashboard v1.0.0*
