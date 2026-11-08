import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { db, pool } from './db/client.js';

const app = new Hono();

// LB のヘルスチェック。DB を見ない（DB が落ちたときに、LB がアプリまで切り離さないように）
app.get('/health', (c) => c.json({ ok: true }));

app.get('/api/health', async (c) => {
	await db.execute('SELECT 1');
	return c.json({ ok: true });
});

app.use('/*', serveStatic({ root: './public' }));

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
	console.log(`listening on :${info.port}`);
});

// docker stop の SIGTERM で、受け付け中のリクエストを終えてから止まる
process.on('SIGTERM', () => {
	server.close(() => pool.end().then(() => process.exit(0)));
});
