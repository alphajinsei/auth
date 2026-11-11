// サーバー側のセッション。Cookie には乱数の ID だけを入れ、DB にはその SHA-256 を置く
// 流れ：docs/steps/1-password-session.md
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { db } from './db/client.js';
import { sessions, users } from './db/schema.js';

// __Host- の接頭辞：Secure 必須、Path=/、Domain なし（このホスト専用。サブドメインから上書きされない）
const COOKIE = '__Host-session';
const TTL_MS = 12 * 60 * 60 * 1000; // 12時間。延長はしない（ログインから12時間で切れる）
const PENDING_TTL_MS = 5 * 60 * 1000; // 仮のセッション（6桁を待っている間）は5分

type Stage = 'password' | 'full';

// セッション ID は 256 ビットの乱数なので、総当たりできない。パスワードと違い、遅いハッシュは要らない
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ログインに成功したとき（段1の図「ログイン」の 8〜9）。
// TOTP の利用者は、パスワードが通った時点で stage='password'（仮）、6桁が通ったら stage='full'（本物）で呼ぶ
// （段2の図「ログイン」）。どちらも ID を新しく作るので、仮から本物に上がる瞬間にも ID が変わる
export async function startSession(c: Context, userId: string, stage: Stage, amr: string) {
	// セッション固定の対策：ブラウザが持ってきた古い ID は使わず、捨てて作り直す
	const old = getCookie(c, COOKIE);
	if (old) await db.delete(sessions).where(eq(sessions.idHash, sha256(old)));

	const id = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + (stage === 'full' ? TTL_MS : PENDING_TTL_MS));
	await db.insert(sessions).values({ idHash: sha256(id), userId, expiresAt, stage, amr });

	setCookie(c, COOKIE, id, {
		httpOnly: true, // JavaScript から読めない（XSS で盗まれにくい）
		secure: true, // HTTPS のときだけ送る（localhost は例外としてブラウザが送る）
		sameSite: 'Lax', // よそのサイトからの POST には付けない（CSRF の対策）
		path: '/',
		expires: expiresAt,
	});
}

async function sessionUser(c: Context, stage: Stage) {
	const id = getCookie(c, COOKIE);
	if (!id) return null;
	const [row] = await db
		.select({ id: users.id, username: users.username, amr: sessions.amr })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.idHash, sha256(id)), eq(sessions.stage, stage), gt(sessions.expiresAt, new Date())));
	return row ?? null;
}

// 以後のリクエストで、誰かを判断する（段1の図「以後のリクエスト」）。本物のセッションだけを返す。
// 仮のセッション（6桁がまだ）では、アカウントの画面などは開けない
export const currentUser = (c: Context) => sessionUser(c, 'full');

// 6桁の画面で、「パスワードまで済んだのは誰か」を引く
export const pendingUser = (c: Context) => sessionUser(c, 'password');

// ログアウト（図「ログアウト」）。大事なのは DB の行を消すこと。Cookie を消すのは、ブラウザへの後片付けの依頼
export async function endSession(c: Context) {
	const id = getCookie(c, COOKIE);
	if (id) await db.delete(sessions).where(eq(sessions.idHash, sha256(id)));
	deleteCookie(c, COOKIE, { path: '/', secure: true });
}
