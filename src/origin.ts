// CSRF の対策：状態を変えるリクエスト（POST）は、自分の画面から送られたものだけを受け付ける。
// ブラウザは POST に Origin ヘッダー（送信元のページのスキーム・ホスト・ポート）を必ず付け、JavaScript からは偽れない。
// Cookie の SameSite=Lax と二重にしている（古いブラウザや、SameSite の例外に備える）
import type { MiddlewareHandler } from 'hono';

export function checkOrigin(allowed: string): MiddlewareHandler {
	return async (c, next) => {
		if (c.req.method === 'POST' && c.req.header('origin') !== allowed) {
			return c.text('forbidden: unexpected origin', 403);
		}
		await next();
	};
}
