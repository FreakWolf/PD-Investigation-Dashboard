import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve directories for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // support large payloads if needed
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend assets
app.use(express.static(PUBLIC_DIR));

// Register API routes
app.use('/api', apiRouter);

// Fallback for SPA or health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Start the server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` PD Investigation Dashboard Backend Running`);
  console.log(` Port:    http://localhost:${PORT}`);
  console.log(` Local Time: ${new Date().toLocaleString()}`);
  console.log(`==================================================`);
});
