import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApiServer } from './server/index.js';
import { getTrustProxyConfig } from './server/config.js';
import { logger, httpLogger } from './server/lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, 'dist');
const distAssetsDir = path.join(distDir, 'assets');
const indexHtmlPath = path.join(distDir, 'index.html');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.set('trust proxy', getTrustProxyConfig());

// Structured HTTP request logging with per-request requestId & sensitive header/body redaction
app.use(httpLogger);

// Global security headers (no X-Frame-Options / frame-ancestors / CSP for AI Studio iframe compatibility)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const NON_COMPRESSIBLE_PATH_RE =
  /\.(glb|gltf|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|mp4|webm|mov|m4v|avi|mkv|ogv)$/i;

/**
 * Compression filter:
 * - Compresses text, JS, CSS, JSON, and SVG/XML responses (brotli/gzip).
 * - Explicitly skips .glb 3D models, raster images, and video responses.
 */
function shouldCompressResponse(req, res) {
  if (req.headers['x-no-compression']) {
    return false;
  }

  const reqPath = req.path || '';
  if (NON_COMPRESSIBLE_PATH_RE.test(reqPath)) {
    return false;
  }

  const rawContentType = res.getHeader('Content-Type');
  const contentType = Array.isArray(rawContentType)
    ? rawContentType.join('; ').toLowerCase()
    : String(rawContentType || '').toLowerCase();

  if (contentType) {
    if (
      contentType.startsWith('model/') ||
      contentType.startsWith('video/') ||
      contentType.startsWith('audio/') ||
      contentType.includes('application/octet-stream')
    ) {
      return false;
    }

    // Skip raster/binary images, but allow image/svg+xml (text XML)
    if (
      contentType.startsWith('image/') &&
      !contentType.includes('svg+xml')
    ) {
      return false;
    }

    if (
      contentType.startsWith('text/') ||
      contentType.includes('javascript') ||
      contentType.includes('ecmascript') ||
      contentType.includes('json') ||
      contentType.includes('css') ||
      contentType.includes('svg+xml') ||
      contentType.includes('xml')
    ) {
      return true;
    }
  }

  return compression.filter(req, res);
}

app.use(
  compression({
    threshold: 0,
    filter: shouldCompressResponse,
  })
);

/**
 * Helper to determine if an asset filename in `assets/` has a Vite/Rolldown build hash.
 * Unhashed SVGs from `public/assets/*.svg` (e.g., `01.O-Neck.svg`, `logo-editorsuite.svg`) are excluded.
 */
function isHashedBuildAsset(relPath, fileName) {
  if (!relPath.startsWith('assets/')) return false;
  if (fileName.toLowerCase().endsWith('.svg')) return false;
  return /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(fileName);
}

/**
 * Applies deterministic Cache-Control and Content-Type headers to static files:
 * - index.html -> Cache-Control: no-cache
 * - /models/*.glb and unhashed /assets/*.svg -> Cache-Control: public, max-age=86400
 * - hashed /assets/* -> Cache-Control: public, max-age=31536000, immutable
 */
function applyStaticCacheHeaders(res, relPath, fileName) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.glb')) {
    res.setHeader('Content-Type', 'model/gltf-binary');
  }

  if (fileName === 'index.html') {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }

  if (
    (relPath.startsWith('models/') && lowerName.endsWith('.glb')) ||
    (relPath.startsWith('assets/') && lowerName.endsWith('.svg'))
  ) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return;
  }

  if (isHashedBuildAsset(relPath, fileName)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

// REST API routes at /api/v1 (registered BEFORE static files & SPA fallback)
registerApiServer(app);

const isDev =
  process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

let httpServer = null;
let isShuttingDown = false;

async function startServer() {
  if (isDev) {
    // Apply consistent Cache-Control headers for static models, unhashed SVGs, and index.html in dev
    app.use((req, res, next) => {
      const cleanPath = req.path.replace(/^\/+/, '');
      const fileName = path.basename(cleanPath);

      if (req.path === '/' || req.path === '/index.html' || req.path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (
        (cleanPath.startsWith('models/') && fileName.toLowerCase().endsWith('.glb')) ||
        (cleanPath.startsWith('assets/') && fileName.toLowerCase().endsWith('.svg'))
      ) {
        if (fileName.toLowerCase().endsWith('.glb')) {
          res.setHeader('Content-Type', 'model/gltf-binary');
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else if (
        req.path.startsWith('/src/') ||
        req.path.startsWith('/@')
      ) {
        res.setHeader('Cache-Control', 'no-store');
      }
      next();
    });

    // Also serve built hashed assets from dist/assets if present so curl checks work in --dev mode
    app.use(
      '/assets',
      express.static(distAssetsDir, {
        fallthrough: true,
        setHeaders(res, filePath) {
          const fileName = path.basename(filePath);
          const relPath = `assets/${fileName}`;
          applyStaticCacheHeaders(res, relPath, fileName);
        },
      })
    );

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static build artifacts from dist/
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          const relPath = path.relative(distDir, filePath).replace(/\\/g, '/');
          const fileName = path.basename(filePath);
          applyStaticCacheHeaders(res, relPath, fileName);
        },
      })
    );

    // SPA fallback to index.html with no-cache
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtmlPath);
    });
  }

  httpServer = app.listen(PORT, '0.0.0.0', () => {
    logger.info(
      {
        port: PORT,
        mode: isDev ? 'dev+vite' : 'production',
      },
      `Server (${isDev ? 'dev+vite' : 'production'}) listening on http://0.0.0.0:${PORT}`
    );
  });
}

function gracefulShutdown(reason, exitCode = 0, err = null) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (err) {
    logger.fatal(
      { err, reason },
      `Fatal process event (${reason}) — initiating graceful shutdown`
    );
  } else {
    logger.info(
      { signal: reason },
      `Received ${reason} — initiating graceful shutdown`
    );
  }

  const forceExitTimer = setTimeout(() => {
    logger.error(
      { reason },
      'Graceful shutdown timed out after 10s — forcing exit'
    );
    process.exit(exitCode || 1);
  }, 10_000);
  forceExitTimer.unref();

  if (httpServer) {
    httpServer.close((closeErr) => {
      clearTimeout(forceExitTimer);
      if (closeErr) {
        logger.error({ err: closeErr }, 'Error while closing HTTP server');
        process.exit(1);
        return;
      }
      logger.info('HTTP server closed cleanly');
      process.exit(exitCode);
    });
  } else {
    clearTimeout(forceExitTimer);
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM', 0);
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT', 0);
});

process.on('unhandledRejection', (reason) => {
  const err =
    reason instanceof Error
      ? reason
      : new Error(`Unhandled rejection: ${String(reason)}`);
  gracefulShutdown('unhandledRejection', 1, err);
});

process.on('uncaughtException', (err) => {
  gracefulShutdown('uncaughtException', 1, err);
});

startServer().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
