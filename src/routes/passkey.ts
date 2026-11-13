// パスキーの登録（アカウントの画面から）。流れ：docs/steps/3-passkey.md の図「登録」
// 番号の読み方
//   「登録 7」   ＝ 図「登録」の 7 番の矢印（図の丸数字。Note には番号がないので「登録 7 のあとの Note」と書く）
//   「ログイン 7」＝ 図「ログイン」の 7 番の矢印
//   「要素③」   ＝ 「1. 技術の要素」の表の ③
// どの関数が図のどこに当たるかの一覧は、文書の各図の下の「図とコードの対応」の表
import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { db } from '../db/client.js';
import { webauthnChallenges, webauthnCredentials } from '../db/schema.js';
import { currentUser } from '../session.js';
import { newChallenge, registrationOptions, verifyRegistration } from '../webauthn.js';

export const passkey = new Hono();

// challenge を覚えておく Cookie。セッションの Cookie とは別にする（3-b のログインでは、まだセッションがないため）
const COOKIE = '__Host-webauthn';
const TTL_MS = 5 * 60 * 1000;
type Purpose = 'register' | 'login';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function audit(event: string, fields: Record<string, unknown>) {
	console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

// 登録 2 のあとの Note ／ ログイン 2 のあとの Note：challenge を作って DB に置き、その行を指す乱数を Cookie に入れる
async function issueChallenge(c: Context, purpose: Purpose, userId: string | null) {
	await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date())); // 期限切れの後片付け
	const challenge = newChallenge();
	const id = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + TTL_MS);
	await db.insert(webauthnChallenges).values({ idHash: sha256(id), challenge, purpose, userId, expiresAt });
	setCookie(c, COOKIE, id, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', expires: expiresAt });
	return challenge;
}

// 登録 7 ／ ログイン 7 を受けたとき：challenge を取り出し、同時に消す（一度しか使えない）。
// DELETE が実際に行を消したときだけ返すので、同じ応答が同時に2本来ても、通るのは1本だけ
async function takeChallenge(c: Context, purpose: Purpose) {
	const id = getCookie(c, COOKIE);
	deleteCookie(c, COOKIE, { path: '/', secure: true });
	if (!id) return null;
	const [row] = await db.select().from(webauthnChallenges).where(eq(webauthnChallenges.idHash, sha256(id)));
	if (!row || row.purpose !== purpose || row.expiresAt < new Date()) return null;
	const [res] = await db.delete(webauthnChallenges).where(eq(webauthnChallenges.idHash, row.idHash));
	return res.affectedRows === 1 ? row : null;
}

// 登録 2 を受けて、登録 3 を返す：options を渡す。ログイン中であること（要素⑥ 既存のログインから信頼を借りる）が前提
passkey.post('/account/passkey/options', async (c) => {
	const user = await currentUser(c);
	if (!user) return c.json({ error: 'ログインしてください' }, 401);
	const existing = await db
		.select({ id: webauthnCredentials.id, transports: webauthnCredentials.transports })
		.from(webauthnCredentials)
		.where(eq(webauthnCredentials.userId, user.id));
	const challenge = await issueChallenge(c, 'register', user.id);
	return c.json(registrationOptions(user, challenge, existing));
});

// 登録 7 を受けて、7 のあとの Note 2つ（確認）→ 登録 8（保存）→ 登録 9（返事）
passkey.post('/account/passkey/verify', async (c) => {
	const user = await currentUser(c);
	if (!user) return c.json({ error: 'ログインしてください' }, 401);

	const row = await takeChallenge(c, 'register');
	// 発行したときと同じ利用者か（途中でログインし直した、などを弾く）
	if (!row || row.userId !== user.id) return c.json({ error: '時間切れです。もう一度やり直してください' }, 400);

	const body = await c.req.json();
	let cred;
	try {
		cred = verifyRegistration(body.credential, row.challenge);
	} catch (e) {
		audit('passkey_register_failed', { username: user.username, reason: (e as Error).message });
		return c.json({ error: 'パスキーを登録できませんでした' }, 400);
	}

	const name = String(body.name ?? '').trim().slice(0, 64) || 'パスキー';
	const [dup] = await db.select({ id: webauthnCredentials.id }).from(webauthnCredentials).where(eq(webauthnCredentials.id, cred.id));
	if (dup) return c.json({ error: 'このパスキーは登録済みです' }, 400);

	await db.insert(webauthnCredentials).values({ ...cred, userId: user.id, name });
	audit('passkey_registered', { username: user.username, name });
	return c.json({ ok: true });
});

// アカウントの画面に出す一覧
export const listPasskeys = (userId: string) =>
	db
		.select({ name: webauthnCredentials.name, createdAt: webauthnCredentials.createdAt, lastUsedAt: webauthnCredentials.lastUsedAt })
		.from(webauthnCredentials)
		.where(eq(webauthnCredentials.userId, userId))
		.orderBy(webauthnCredentials.createdAt);
