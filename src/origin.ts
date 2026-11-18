// CSRF の対策：状態を変えるリクエスト（POST）は、自分の画面から送られたものだけを受け付ける。
// ブラウザは POST に Origin ヘッダー（送信元のページのスキーム・ホスト・ポート）を必ず付け、JavaScript からは偽れない。
// Cookie の SameSite=Lax と二重にしている（古いブラウザや、SameSite の例外に備える）
import type { MiddlewareHandler } from 'hono';

// 例外：/token（ステップ4）と /revoke（ステップ5）。ブラウザではなく demo-app のサーバーが呼ぶので Origin が付かない。
// Cookie を使わず、毎回 client_secret を Authorization ヘッダーで見せる（別のサイトのページからは付けられない）ので、CSRF の心配がない
const EXEMPT = ['/token', '/revoke'];

export function checkOrigin(allowed: string): MiddlewareHandler {
	return async (c, next) => {
		if (c.req.method === 'POST' && !EXEMPT.includes(c.req.path) && c.req.header('origin') !== allowed) {
			return c.text('forbidden: unexpected origin', 403);
		}
		await next();
	};
}
