// OIDC の OP（auth）として公開する URL。流れ：docs/steps/4-oidc.md
// 番号の読み方は src/webauthn.ts と同じ（「ログイン 4」＝ 4-oidc.md の図「ログイン」の 4 番の矢印、「要素②」＝「1. 技術の要素」の ②）
// 4-a：Discovery と JWKS（図「準備」）。4-b：/authorize（図「ログイン」の 4〜9）。/token、/userinfo は 4-c
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { db } from '../db/client.js';
import { authorizationCodes, oauthClients, oauthConsents } from '../db/schema.js';
import { jwks } from '../jwt.js';
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
