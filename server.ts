import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { getDb } from './server/db.ts';
import { createApiRouter } from './server/routes.ts';

async function startServer(): Promise<void> {
  // Initialize SQLite schema and initial payment/customer seed on startup
  getDb();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '6mb' }));

  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`ZENTRO server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ZENTRO server:', err);
  process.exit(1);
});
