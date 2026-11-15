// OIDC の OP（auth）として公開する URL。流れ：docs/steps/4-oidc.md
// 番号の読み方は src/webauthn.ts と同じ（「ログイン 4」＝ 4-oidc.md の図「ログイン」の 4 番の矢印、「要素②」＝「1. 技術の要素」の ②）
// 4-a：Discovery と JWKS（図「準備」）。4-b：/authorize（図「ログイン」の 4〜9）。4-c：/token（ログイン 11〜12）、/userinfo（図「/userinfo」）
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { db } from '../db/client.js';
import { accessTokens, authorizationCodes, oauthClients, oauthConsents, users } from '../db/schema.js';
import { jwks, signJwt } from '../jwt.js';
import { currentUser, rememberReturnTo } from '../session.js';
import { authorizeErrorPage, consentPage } from '../views.js';

export const oidc = new Hono();

// issuer：auth の識別子。ID トークンの iss に入り、RP は「期待した issuer か」を確かめる。末尾に / を付けない（完全一致で比べられるため）
export const issuer = process.env.PUBLIC_ORIGIN!;

// 準備 1 → 2：Discovery。RP は issuer の URL だけを知っていれば、ここから残りの設定を全部読める
// 項目の名前は OpenID Connect Discovery 1.0 の決まり
oidc.get('/.well-known/openid-configuration', (c) =>
	c.json({
		issuer,
		authorization_endpoint: `${issuer}/authorize`,
		token_endpoint: `${issuer}/token`,
		userinfo_endpoint: `${issuer}/userinfo`,
		jwks_uri: `${issuer}/jwks.json`,
		scopes_supported: ['openid', 'profile'],
		response_types_supported: ['code'], // 認可コードの流れだけ（implicit は出さない）
		grant_types_supported: ['authorization_code'],
		subject_types_supported: ['public'], // sub はどの RP にも同じ値（users.id）
		id_token_signing_alg_values_supported: ['ES256'],
		token_endpoint_auth_methods_supported: ['client_secret_basic'], // client_secret は Authorization ヘッダーで送る
		code_challenge_methods_supported: ['S256'], // PKCE は SHA-256 だけ（plain は受けない）
		claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'amr', 'preferred_username'],
	}),
);

// 準備 3 → 4：JWKS。公開鍵は秘密ではないので、誰でも取れる
oidc.get('/jwks.json', (c) => c.json(jwks));

// ---- /authorize（図「ログイン」の 4〜9）----

const CODE_TTL_MS = 60 * 1000;
const SUPPORTED_SCOPES = ['openid', 'profile'];
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

function audit(event: string, fields: Record<string, unknown>) {
	console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

// /authorize の要求。GET では URL の query、同意の POST ではフォームの隠し項目から読む
type AuthzRequest = {
	clientId: string;
	clientName: string;
	redirectUri: string;
	scope: string; // 知っている scope だけに絞ったもの（空白区切り）
	state: string;
	nonce: string | null;
	codeChallenge: string;
};

type Checked = { ok: true; req: AuthzRequest } | { ok: false; response: Response };

// ログイン 4 のあとの 1つ目の Note：要求を照らす。
// 段階が2つある。client_id と redirect_uri が確かめられるまでは、redirect_uri へ戻さず auth の画面にエラーを出す
// （登録にない URL へエラーを送ると、それ自体を攻撃の足がかりにされる）。確かめられたあとのエラーは、redirect_uri へ返す
async function checkRequest(c: Context, p: Record<string, string | undefined>): Promise<Checked> {
	const clientId = p.client_id ?? '';
	const redirectUri = p.redirect_uri ?? '';
	const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
	if (!client) return { ok: false, response: await c.html(authorizeErrorPage('この client は登録されていません'), 400) };
	// 要素②：登録した文字列と、1文字残らず同じであること（前方一致やワイルドカードは許さない）
	if (!(JSON.parse(client.redirectUris) as string[]).includes(redirectUri)) {
		audit('authorize_bad_redirect_uri', { clientId, redirectUri });
		return { ok: false, response: await c.html(authorizeErrorPage('redirect_uri が登録と一致しません'), 400) };
	}

	const state = p.state ?? '';
	const back = (error: string) => ({ ok: false as const, response: c.redirect(withParams(redirectUri, { error, state }), 302) });
	if (p.response_type !== 'code') return back('unsupported_response_type'); // 認可コードの流れだけ
	const requested = (p.scope ?? '').split(' ').filter(Boolean);
	if (!requested.includes('openid')) return back('invalid_scope'); // openid がなければ OIDC の要求ではない
	// 要素⑥：PKCE は必須。S256（SHA-256）だけを受ける。code_challenge は SHA-256 の base64url で43文字
	if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge ?? '')) return back('invalid_request');
	if (!state) return back('invalid_request'); // 要素⑦：このリポジトリでは state も必須にする（学ぶために3つとも入れる）

	return {
		ok: true,
		req: {
			clientId,
			clientName: client.name,
			redirectUri,
			scope: requested.filter((s) => SUPPORTED_SCOPES.includes(s)).join(' '), // 知らない scope は黙って外す（仕様が許している）
			state,
			nonce: p.nonce || null,
			codeChallenge: p.code_challenge!,
		},
	};
}

// redirect_uri に query を足す（redirect_uri が自分の query を持っていても壊さない）
function withParams(uri: string, params: Record<string, string>) {
	const url = new URL(uri);
	for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
	return url.toString();
}

// ログイン 7 のあとの Note → ログイン 8 → ログイン 9：認可コードを作って保存し、redirect_uri へ戻す
async function issueCode(c: Context, req: AuthzRequest, user: { id: string; amr: string; authTime: Date }) {
	const code = randomBytes(32).toString('base64url');
	await db.insert(authorizationCodes).values({
		codeHash: sha256hex(code),
		clientId: req.clientId,
		userId: user.id,
		redirectUri: req.redirectUri,
		scope: req.scope,
		codeChallenge: req.codeChallenge,
		nonce: req.nonce,
		amr: user.amr,
		authTime: user.authTime,
		expiresAt: new Date(Date.now() + CODE_TTL_MS),
	});
	audit('authorize_code_issued', { clientId: req.clientId, userId: user.id });
	return c.redirect(withParams(req.redirectUri, { code, state: req.state }), 302);
}

// 同意の記録が、今回の scope を全部含んでいるか
async function hasConsent(userId: string, req: AuthzRequest) {
	const [row] = await db
		.select()
		.from(oauthConsents)
		.where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, req.clientId)));
	if (!row) return false;
	const granted = row.scope.split(' ');
	return req.scope.split(' ').every((s) => granted.includes(s));
}

// ログイン 4：GET /authorize
oidc.get('/authorize', async (c) => {
	const checked = await checkRequest(c, c.req.query());
	if (!checked.ok) return checked.response;
	const { req } = checked;

	// ログイン 4 のあとの 2つ目の Note：auth にログインしていなければ、ログイン画面へ寄り道する。
	// 戻り先（この /authorize の URL そのもの）を Cookie に覚え、ログインが済んだら戻ってくる（段1〜3のどの方法でも）
	const user = await currentUser(c);
	if (!user) {
		const url = new URL(c.req.url);
		rememberReturnTo(c, `${url.pathname}${url.search}`);
		return c.redirect('/login', 302);
	}

	// 同意が記録済みなら、同意画面を出さずにコードを出す（図「2つ目以降のログイン」）
	if (await hasConsent(user.id, req)) return issueCode(c, req, user);

	// ログイン 5：同意画面。要求の中身は、隠し項目でそのまま POST に持ち回る（POST で、もう一度照らす）
	return c.html(consentPage(user.username, req));
});

// ログイン 7：POST /authorize（同意の画面の「許可する」「許可しない」）
// フォームの隠し項目は利用者が書き換えられるので、GET と同じ照合をもう一度する。
// 別のサイトから、この POST を勝手に送らせる（同意を自動で押させる）攻撃は、Origin の確認（src/origin.ts）で止まる
oidc.post('/authorize', async (c) => {
	const body = (await c.req.parseBody()) as Record<string, string>;
	const checked = await checkRequest(c, body);
	if (!checked.ok) return checked.response;
	const { req } = checked;

	const user = await currentUser(c);
	if (!user) return c.redirect('/login', 303);

	if (body.decision !== 'allow') {
		audit('authorize_denied', { clientId: req.clientId, userId: user.id });
		return c.redirect(withParams(req.redirectUri, { error: 'access_denied', state: req.state }), 302);
	}

	// ログイン 8：同意を記録する（次からは同意画面を出さない）
	await db
		.insert(oauthConsents)
		.values({ userId: user.id, clientId: req.clientId, scope: req.scope })
		.onDuplicateKeyUpdate({ set: { scope: req.scope } });
	return issueCode(c, req, user);
});

// ---- /token（図「ログイン」の 11〜12）。demo-app のサーバーから、裏の通信で呼ばれる ----

const ID_TOKEN_TTL_S = 10 * 60; // ID トークンは受け取った直後に確かめて使い終わるので、短くてよい
const ACCESS_TOKEN_TTL_S = 60 * 60;

// /token のエラー。形は OAuth 2.0 の決まり（RFC 6749 5.2）：JSON で { error, error_description }
function tokenError(c: Context, error: string, description: string, status: 400 | 401 = 400) {
	audit('token_error', { error, description });
	// invalid_client で 401 を返すときは、どの方式で認証してほしいかを WWW-Authenticate で示す
	if (status === 401) c.header('WWW-Authenticate', 'Basic realm="auth"');
	return c.json({ error, error_description: description }, status);
}

// ログイン 11 のあとの Note：client を認証する（client_secret_basic）。
// Authorization: Basic base64(client_id:client_secret)。どちらも URL エンコードしてから「:」でつなぐ決まり（RFC 6749 2.3.1）
async function authenticateClient(c: Context) {
	const header = c.req.header('authorization') ?? '';
	if (!header.startsWith('Basic ')) return null;
	const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
	const colon = decoded.indexOf(':');
	if (colon < 0) return null;
	const id = decodeURIComponent(decoded.slice(0, colon));
	const secret = decodeURIComponent(decoded.slice(colon + 1));
	const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
	if (!client) return null;
	// ハッシュ同士を、かかる時間が中身によらない比べ方で比べる（1文字目から順に比べて途中で止まると、時間の差から推測されうる）
	const ok = timingSafeEqual(Buffer.from(sha256hex(secret)), Buffer.from(client.secretHash));
	return ok ? client : null;
}

// ログイン 12：認可コードを取り出して消す（一度きり。要素④）。
// 先に読んで、消せたときだけ使う。同じコードで同時に2つ来ても、消せる（affectedRows が 1 になる）のは片方だけ
async function takeCode(code: string) {
	const [row] = await db.select().from(authorizationCodes).where(eq(authorizationCodes.codeHash, sha256hex(code)));
	if (!row) return null;
	const [res] = await db.delete(authorizationCodes).where(eq(authorizationCodes.codeHash, row.codeHash));
	return res.affectedRows === 1 ? row : null;
}

const toSeconds = (d: Date) => Math.floor(d.getTime() / 1000);

// ログイン 11：POST /token
oidc.post('/token', async (c) => {
	const client = await authenticateClient(c);
	if (!client) return tokenError(c, 'invalid_client', 'client authentication failed', 401);

	const body = (await c.req.parseBody()) as Record<string, string>;
	if (body.grant_type !== 'authorization_code') return tokenError(c, 'unsupported_grant_type', 'only authorization_code');

	// 期限の切れたコードを、ついでに掃除する（ここまで来る client は認証済みなので、掃除を外から好きなだけ走らせられない）
	await db.delete(authorizationCodes).where(lt(authorizationCodes.expiresAt, new Date()));

	const row = await takeCode(body.code ?? '');
	// ログイン 12 のあとの 1つ目の Note：コードの期限、client_id、redirect_uri が、/authorize のときと一致するか。
	// どれで外れても同じ invalid_grant を返す（どこが違ったかを、相手に教えない）
	if (!row) return tokenError(c, 'invalid_grant', 'unknown or used code');
	// 期限切れは、ふつうは直前の掃除で消えていて「unknown」になる。ここは掃除と取り出しの間に切れた場合の備え
	if (row.expiresAt < new Date()) return tokenError(c, 'invalid_grant', 'code expired');
	if (row.clientId !== client.id) return tokenError(c, 'invalid_grant', 'code was issued to another client');
	if (row.redirectUri !== body.redirect_uri) return tokenError(c, 'invalid_grant', 'redirect_uri mismatch');

	// 同じ Note の続き：PKCE（要素⑥）。SHA-256（code_verifier）の base64url が、/authorize で受けた code_challenge と一致するか。
	// code_verifier は 43〜128文字（RFC 7636 4.1）。コードを横取りしただけの人は、元の乱数（verifier）を知らないので、ここで止まる
	const verifier = body.code_verifier ?? '';
	if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return tokenError(c, 'invalid_grant', 'bad code_verifier');
	if (createHash('sha256').update(verifier).digest('base64url') !== row.codeChallenge) {
		return tokenError(c, 'invalid_grant', 'PKCE verification failed');
	}

	const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, row.userId));
	if (!user) return tokenError(c, 'invalid_grant', 'user no longer exists');
	const scopes = row.scope.split(' ');
	const now = Math.floor(Date.now() / 1000);

	// ログイン 12 のあとの 2つ目の Note：ID トークンを作り、秘密鍵で署名する（要素⑧）
	const idToken = signJwt({
		iss: issuer, // 誰が出したか。demo-app は Discovery で知った issuer と比べる
		sub: row.userId, // 利用者の ID。ユーザー名と違って変わらないので、RP はこれで利用者を見分ける
		aud: client.id, // 誰に宛てたか。別の RP 宛ての ID トークンを使い回させない
		exp: now + ID_TOKEN_TTL_S,
		iat: now,
		auth_time: toSeconds(row.authTime), // 実際にログインした時刻（SSO の2回目は、最初の時刻のまま）
		...(row.nonce ? { nonce: row.nonce } : {}), // 要素⑨：/authorize で受けた値をそのまま返す
		amr: row.amr.split(' '), // RFC 8176 では配列。例：["hwk", "mfa"]
		...(scopes.includes('profile') ? { preferred_username: user.username } : {}),
	});

	// アクセストークン（/userinfo を呼ぶ許可証）。段4は乱数を DB で引く形
	const accessToken = randomBytes(32).toString('base64url');
	await db.delete(accessTokens).where(lt(accessTokens.expiresAt, new Date()));
	await db.insert(accessTokens).values({
		tokenHash: sha256hex(accessToken),
		clientId: client.id,
		userId: row.userId,
		scope: row.scope,
		expiresAt: new Date((now + ACCESS_TOKEN_TTL_S) * 1000),
	});

	audit('token_issued', { clientId: client.id, userId: row.userId });
	// ログイン 13：返事の形は OAuth 2.0（access_token、token_type、expires_in）に、OIDC が id_token を足したもの
	return c.json({
		access_token: accessToken,
		token_type: 'Bearer',
		expires_in: ACCESS_TOKEN_TTL_S,
		scope: row.scope,
		id_token: idToken,
	});
});

// ---- /userinfo（図「/userinfo」）。アクセストークンを見せれば、利用者の情報を返す ----
// 「Bearer」＝持参人。トークンを持っている人なら誰でも使える（盗まれたら使われる。だから短命で、TLS の上だけで送る）

function bearerError(c: Context, description: string) {
	// RFC 6750 3.1：トークンが不正なときは 401 と、WWW-Authenticate で理由を返す
	c.header('WWW-Authenticate', `Bearer error="invalid_token", error_description="${description}"`);
	return c.json({ error: 'invalid_token', error_description: description }, 401);
}

oidc.get('/userinfo', async (c) => {
	const header = c.req.header('authorization') ?? '';
	if (!header.startsWith('Bearer ')) return bearerError(c, 'missing bearer token');
	// /userinfo 1 → 2：トークンの SHA-256 から、利用者と scope を引く
	const [row] = await db
		.select({ userId: accessTokens.userId, scope: accessTokens.scope, expiresAt: accessTokens.expiresAt, username: users.username })
		.from(accessTokens)
		.innerJoin(users, eq(users.id, accessTokens.userId))
		.where(eq(accessTokens.tokenHash, sha256hex(header.slice(7))));
	// /userinfo 2 のあとの Note：期限内か。scope に openid があるか
	if (!row || row.expiresAt < new Date()) return bearerError(c, 'unknown or expired token');
	const scopes = row.scope.split(' ');
	if (!scopes.includes('openid')) return c.json({ error: 'insufficient_scope' }, 403);

	// /userinfo 3：sub は ID トークンと同じ値。RP は「ID トークンの sub と一致するか」を確かめる決まり（OIDC Core 5.3.2）
	return c.json({ sub: row.userId, ...(scopes.includes('profile') ? { preferred_username: row.username } : {}) });
});
