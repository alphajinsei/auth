import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, pool } from './db/client.js';
import { memos } from './db/schema.js';

const app = new Hono();

// LB のヘルスチェック。DB を見ない（DB が落ちたときに、LB がアプリまで切り離さないように）
app.get('/health', (c) => c.json({ ok: true }));

app.get('/api/health', async (c) => {
	await db.execute('SELECT 1');
	return c.json({ ok: true });
});

app.get('/api/memos', async (c) => {
	const rows = await db.select().from(memos).orderBy(asc(memos.id));
	return c.json(rows);
});

app.post('/api/memos', async (c) => {
	const { text } = await c.req.json<{ text: string }>();
	// MySQL には RETURNING がないので、ID を受け取ってから読み直す
	const [{ id }] = await db.insert(memos).values({ text }).$returningId();
	const [memo] = await db.select().from(memos).where(eq(memos.id, id));
	return c.json(memo, 201);
});

app.delete('/api/memos/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const [result] = await db.delete(memos).where(eq(memos.id, id));
	if (result.affectedRows === 0) return c.json({ error: 'not found' }, 404);
	return c.body(null, 204);
});

app.use('/*', serveStatic({ root: './public' }));

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
	console.log(`listening on :${info.port}`);
});

// docker stop の SIGTERM で、受け付け中のリクエストを終えてから止まる
process.on('SIGTERM', () => {
	server.close(() => pool.end().then(() => process.exit(0)));
});
