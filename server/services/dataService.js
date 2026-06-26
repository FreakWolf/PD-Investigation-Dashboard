import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

// ============================================================
// UNC-safe path loader: reads .env manually to avoid dotenv
// backslash parsing issues with Windows UNC paths (\\server\share)
// ============================================================
function loadEnvUncSafe() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};

  const result = {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

const env = loadEnvUncSafe();

// Resolve default paths relative to the user's local profile folder
const fallbackInvoiceDir = path.join(os.homedir(), 'Downloads', 'PD App', 'Invoice');
const fallbackRebniDir = path.join(os.homedir(), 'Downloads', 'PD App', 'REBNI');

// Load base paths - UNC network paths or local fallback path
const BASE_INVOICE_DIR = env.INVOICE_DIR || fallbackInvoiceDir;
const BASE_REBNI_DIR = env.REBNI_DIR || fallbackRebniDir;

// ============================================================
// Query Result Cache
// key: "filePath|VENDORCODE"  →  value: filtered records array
// ============================================================
const queryCache = new Map();

// ============================================================
// In-Flight Request Deduplication
// If two requests ask for the same vendor+file before the first
// read completes, they both wait on the SAME Promise instead of
// launching two separate file reads.
// ============================================================
const inFlight = new Map();

export function clearCache() {
  const count = queryCache.size;
  queryCache.clear();
  console.log(`Cache cleared: ${count} entries removed.`);
}

export function getCacheStats() {
  const stats = [];
  for (const [key, records] of queryCache.entries()) {
    stats.push({ key, records: records.length });
  }
  return { totalEntries: queryCache.size, entries: stats };
}

/**
 * Scan the directories and get lists of grouped unique seller base names
 */
export async function getAvailableSellers() {
  try {
    const invoiceFiles = await fs.promises.readdir(BASE_INVOICE_DIR);
    const rebniFiles = await fs.promises.readdir(BASE_REBNI_DIR);

    const getBaseSellerName = (file) => {
      const withoutExt = file.replace(/\.txt$/i, '');
      // Strip trailing digits (e.g. Cocoblu1 -> Cocoblu)
      return withoutExt.replace(/\d+$/, '');
    };

    // Filter, map to base name, deduplicate, and sort
    const invoiceSellersSet = new Set(
      invoiceFiles
        .filter(file => file.toLowerCase().endsWith('.txt'))
        .map(getBaseSellerName)
    );
    const invoiceSellers = Array.from(invoiceSellersSet).sort();
      
    const rebniSellersSet = new Set(
      rebniFiles
        .filter(file => file.toLowerCase().endsWith('.txt'))
        .map(getBaseSellerName)
    );
    const rebniSellers = Array.from(rebniSellersSet).sort();

    return { invoiceSellers, rebniSellers };
  } catch (error) {
    console.error('Error scanning seller directories:', error);
    throw new Error(`Failed to scan seller directories: ${error.message}`);
  }
}

/**
 * Stream a TSV file line-by-line and filter by vendor_code.
 *
 * Optimizations:
 *  1. highWaterMark=64MB: reads file in large 64MB chunks instead of the
 *     default 64KB, reducing network round-trips from ~20,000 to ~20 for a 1.3GB file.
 *  2. In-memory cache: identical vendor+file queries are served instantly
 *     from cache on subsequent calls without touching the file again.
 *
 * @param {string} filePath - Absolute path to the TSV file
 * @param {string} vendorCode - The vendor code to filter by
 * @param {Array<string>} expectedColumns - List of columns we expect
 * @returns {Promise<Array<Object>>} - Array of matched records
 */
export function filterTsvByVendorCode(filePath, vendorCode, expectedColumns) {
  const targetVendor = vendorCode.trim().toUpperCase();
  const cacheKey = `${filePath}|${targetVendor}`;

  // === Cache Hit: return instantly ===
  if (queryCache.has(cacheKey)) {
    const cached = queryCache.get(cacheKey);
    console.log(`[CACHE HIT] ${path.basename(filePath)} for ${targetVendor} → ${cached.length} records (instant)`);
    return Promise.resolve(cached);
  }

  // === In-Flight Deduplication: join an existing read instead of starting a new one ===
  if (inFlight.has(cacheKey)) {
    console.log(`[IN-FLIGHT] ${path.basename(filePath)} for ${targetVendor} → joining existing read`);
    return inFlight.get(cacheKey);
  }

  // === Cache Miss: stream and filter file ===
  const readPromise = new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      inFlight.delete(cacheKey);
      return reject(new Error(`File not found: ${path.basename(filePath)}`));
    }

    const matchedRecords = [];
    const startTime = Date.now();

    // KEY OPTIMIZATION: 64MB read buffer instead of default 64KB.
    // For a 1.3GB network file, this cuts network round-trips from ~20,000 to ~20.
    const fileStream = fs.createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024 * 1024   // 64 MB
    });

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
      terminal: false           // slight performance boost for non-TTY streams
    });

    let headers = [];
    let isHeaderLine = true;
    let vendorIdx = -1;

    rl.on('line', (line) => {
      // Split line by tab character
      const parts = line.split('\t');

      if (isHeaderLine) {
        headers = parts.map(h => h.trim());
        vendorIdx = headers.indexOf('vendor_code');
        isHeaderLine = false;

        if (vendorIdx === -1) {
          rl.close();
          reject(new Error(`Column 'vendor_code' not found in file: ${path.basename(filePath)}`));
        }
        return;
      }

      // Fast early-exit: only check vendor_code column before building object
      const rowVendor = parts[vendorIdx];
      if (!rowVendor || rowVendor.trim().toUpperCase() !== targetVendor) return;

      // Build record only for matching rows
      const record = {};
      expectedColumns.forEach(col => {
        const colIdx = headers.indexOf(col);
        record[col] = (colIdx !== -1 && colIdx < parts.length) ? parts[colIdx].trim() : '';
      });
      matchedRecords.push(record);
    });

    rl.on('close', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[CACHE MISS] ${path.basename(filePath)} for ${targetVendor} → ${matchedRecords.length} records in ${elapsed}s`);
      // Store in cache and remove from inFlight
      queryCache.set(cacheKey, matchedRecords);
      inFlight.delete(cacheKey);
      resolve(matchedRecords);
    });

    rl.on('error', (err) => {
      inFlight.delete(cacheKey);
      reject(new Error(`Error reading file ${path.basename(filePath)}: ${err.message}`));
    });
  });

  // Register in inFlight BEFORE returning so concurrent callers can join it
  inFlight.set(cacheKey, readPromise);
  return readPromise;
}

/**
 * Helper to get the absolute path for an Invoice seller file
 */
export function getInvoiceFilePath(filename) {
  return path.join(BASE_INVOICE_DIR, filename);
}

/**
 * Helper to get the absolute path for a REBNI seller file
 */
export function getRebniFilePath(filename) {
  return path.join(BASE_REBNI_DIR, filename);
}

/**
 * Resolve the list of Invoice files for a base seller name
 */
export async function getInvoiceFilesForSeller(sellerName) {
  try {
    const files = await fs.promises.readdir(BASE_INVOICE_DIR);
    const target = sellerName.toLowerCase();
    return files.filter(f => {
      if (!f.toLowerCase().endsWith('.txt')) return false;
      const base = f.replace(/\.txt$/i, '').replace(/\d+$/, '').toLowerCase();
      return base === target;
    });
  } catch (err) {
    console.error(`Error resolving Invoice files for ${sellerName}:`, err);
    return [];
  }
}

/**
 * Resolve the list of REBNI files for a base seller name
 */
export async function getRebniFilesForSeller(sellerName) {
  try {
    const files = await fs.promises.readdir(BASE_REBNI_DIR);
    const target = sellerName.toLowerCase();
    return files.filter(f => {
      if (!f.toLowerCase().endsWith('.txt')) return false;
      const base = f.replace(/\.txt$/i, '').replace(/\d+$/, '').toLowerCase();
      return base === target;
    });
  } catch (err) {
    console.error(`Error resolving REBNI files for ${sellerName}:`, err);
    return [];
  }
}
