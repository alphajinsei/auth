import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { db, pool } from './db/client.js';
import { checkOrigin } from './origin.js';
import { login } from './routes/login.js';
import { passkey } from './routes/passkey.js';
import { totp } from './routes/totp.js';

// 外から見た自分の origin（本番 https://auth.alphajinsei.com、手元 http://localhost:3000）。
// リクエストの URL からは決めない：LB で TLS が終わるので、アプリには http で届く
const origin = process.env.PUBLIC_ORIGIN;
if (!origin) throw new Error('PUBLIC_ORIGIN is not set');

const app = new Hono();

app.use(checkOrigin(origin));
// ログインの状態によって中身が変わる画面を、ブラウザや途中の CDN にキャッシュさせない
app.use(async (c, next) => {
	await next();
	c.header('Cache-Control', 'no-store');
});

// LB のヘルスチェック。DB を見ない（DB が落ちたときに、LB がアプリまで切り離さないように）
app.get('/health', (c) => c.json({ ok: true }));

app.get('/api/health', async (c) => {
	await db.execute('SELECT 1');
	return c.json({ ok: true });
});

app.get('/', (c) => c.redirect('/account', 303));
app.route('/', login);
app.route('/', totp);
app.route('/', passkey);

app.use('/*', serveStatic({ root: './public' }));

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
	console.log(`listening on :${info.port}`);
});

// docker stop の SIGTERM で、受け付け中のリクエストを終えてから止まる
process.on('SIGTERM', () => {
	server.close(() => pool.end().then(() => process.exit(0)));
});
