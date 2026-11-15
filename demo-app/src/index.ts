// demo-app：auth でログインする、小さな RP。流れ：docs/steps/4-oidc.md の図「ログイン」の 1〜3、10〜14
// 段5で独立したリポジトリにするまでの仮住まい。DB は持たない（セッションはメモリに置き、再起動で消える）
import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { discover, fetchJwks, newLoginRequest, verifyIdToken, type Discovery, type IdTokenClaims, type Jwks } from './rp.js';

const env = (name: string) => {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is not set`);
	return v;
};
const ISSUER = env('ISSUER'); // auth の origin（手元 http://localhost:3001、本番 https://auth.alphajinsei.com）
const CLIENT_ID = env('CLIENT_ID');
const CLIENT_SECRET = env('CLIENT_SECRET'); // auth の admin create-client が一度だけ表示したもの
const ORIGIN = env('ORIGIN'); // demo-app 自身の origin（http://localhost:4000）
const REDIRECT_URI = `${ORIGIN}/callback`; // auth に登録したものと1文字残らず同じであること

// 準備：Discovery と JWKS。最初に使うときに取りに行き、覚えておく（auth が起動していなくても、demo-app は起動できるように）
let discovery: Discovery | undefined;
let jwks: Jwks | undefined;
async function config() {
	discovery ??= await discover(ISSUER);
	jwks ??= await fetchJwks(discovery.jwks_uri);
	return { discovery, jwks };
}

// ---- Cookie。auth と同じホスト（localhost）で動くので、名前を auth と分ける ----
// Cookie はポートで分かれない：localhost:3001 の auth の __Host-session は、localhost:4000 にも送られる。名前がぶつかると上書きし合う
const LOGIN_COOKIE = '__Host-demo-login'; // /login → /callback の間だけ、state、nonce、code_verifier を覚える
const SESSION_COOKIE = '__Host-demo-session';
const cookieOpts = { httpOnly: true, secure: true, path: '/' } as const;

type Session = { claims: IdTokenClaims; userinfo: Record<string, unknown> };
const sessions = new Map<string, Session>(); // セッション ID → ログインした人

const app = new Hono();

// CSRF の対策（auth の src/origin.ts と同じ）。demo-app の POST はログアウトだけ
app.use(async (c, next) => {
	if (c.req.method === 'POST' && c.req.header('origin') !== ORIGIN) return c.text('forbidden: unexpected origin', 403);
	await next();
	c.header('Cache-Control', 'no-store');
});

// トップ：ログインしていれば、ID トークンと /userinfo の中身を見せる
app.get('/', (c) => {
	const session = sessions.get(getCookie(c, SESSION_COOKIE) ?? '');
	return c.html(session ? homePage(session) : loginPage());
});

// ログイン 2：GET /login → 2 のあとの Note → ログイン 3：auth の /authorize へ送る
app.get('/login', async (c) => {
	const { discovery } = await config();
	const req = newLoginRequest();
	// 3つとも、/callback で照らすまで覚えておく。10分で切れる。
	// SameSite=Lax：auth から /callback へ戻るのはリダイレクト（GET）なので、別のサイト（本番の auth）から戻っても送られる
	setCookie(c, LOGIN_COOKIE, JSON.stringify({ state: req.state, nonce: req.nonce, verifier: req.verifier }), {
		...cookieOpts,
		sameSite: 'Lax',
		maxAge: 10 * 60,
	});
	const url = new URL(discovery.authorization_endpoint);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		scope: 'openid profile',
		state: req.state,
		nonce: req.nonce,
		code_challenge: req.challenge, // verifier そのものは送らない。/token で初めて見せる
		code_challenge_method: 'S256',
	}).toString();
	return c.redirect(url.toString(), 302);
});

// ログイン 10：GET /callback（code、state）。auth が、ブラウザをここへ戻してくる
app.get('/callback', async (c) => {
	const saved = getCookie(c, LOGIN_COOKIE);
	deleteCookie(c, LOGIN_COOKIE, cookieOpts); // 一度きり
	if (!saved) return c.html(errorPage('ログインの途中の情報がありません（10分たった、または別のブラウザで開いた）'), 400);
	const login = JSON.parse(saved) as { state: string; nonce: string; verifier: string };
	const q = c.req.query();

	// ログイン 10 のあとの Note：state が Cookie の値と一致するか（要素⑦）。
	// 一致しなければ、自分が始めたログインの戻りではない（攻撃者のコードを踏まされた、など）。エラーの戻りも、state を確かめてから信じる
	if (q.state !== login.state) return c.html(errorPage('state が一致しません'), 400);
	if (q.error) return c.html(errorPage(`auth がログインを断りました：${q.error}`), 400);
	if (!q.code) return c.html(errorPage('code がありません'), 400);

	try {
		const { discovery } = await config();
		// ログイン 11：POST /token。ブラウザを通らない、demo-app のサーバーから auth への裏の通信
		const tokens = await exchangeCode(discovery, q.code, login.verifier);
		// ログイン 13 のあとの Note：ID トークンの署名と中身を確かめる
		const claims = await verifyWithRefresh(tokens.id_token, login.nonce);
		// /userinfo 1 → 3：アクセストークンで利用者の情報を取る。sub が ID トークンと同じかを確かめる（OIDC Core 5.3.2）
		const userinfo = await fetchUserinfo(discovery, tokens.access_token);
		if (userinfo.sub !== claims.sub) throw new Error('userinfo sub does not match the ID token');

		// ログイン 14：demo-app のセッションを作る。ここから先、demo-app は auth に問い合わせない
		const id = randomBytes(32).toString('base64url');
		sessions.set(id, { claims, userinfo });
		setCookie(c, SESSION_COOKIE, id, { ...cookieOpts, sameSite: 'Lax', maxAge: 60 * 60 });
		return c.redirect('/', 303);
	} catch (e) {
		console.error(e);
		return c.html(errorPage(`ログインできませんでした：${(e as Error).message}`), 400);
	}
});

// ログアウト：demo-app のセッションだけを消す。auth のセッションは残るので、もう一度ログインすると、
// auth の画面を通らずに戻ってくる（図「2つ目以降のログイン」。auth からもログアウトさせる仕組みは、OIDC の別の仕様で、今回は作らない）
app.post('/logout', (c) => {
	const id = getCookie(c, SESSION_COOKIE);
	if (id) sessions.delete(id);
	deleteCookie(c, SESSION_COOKIE, cookieOpts);
	return c.redirect('/', 303);
});

// ログイン 11 → 13：認可コードを、ID トークンとアクセストークンに引き換える
async function exchangeCode(d: Discovery, code: string, verifier: string) {
	// client_secret_basic：client_id と client_secret を URL エンコードしてから「:」でつなぎ、base64（RFC 6749 2.3.1）
	const basic = Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64');
	const res = await fetch(d.token_endpoint, {
		method: 'POST',
		headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier }),
	});
	const body = (await res.json()) as { id_token?: string; access_token?: string; error?: string; error_description?: string };
	if (!res.ok || !body.id_token || !body.access_token) throw new Error(`token: ${body.error} ${body.error_description ?? ''}`);
	return { id_token: body.id_token, access_token: body.access_token };
}

// 知らない kid が来たら、auth が鍵を入れ替えたのかもしれないので、JWKS を1回だけ取り直す
async function verifyWithRefresh(idToken: string, nonce: string) {
	const expected = { issuer: ISSUER, clientId: CLIENT_ID, nonce };
	try {
		return verifyIdToken(idToken, (await config()).jwks, expected);
	} catch (e) {
		if (!(e as Error).message.startsWith('unknown kid')) throw e;
		jwks = await fetchJwks((await config()).discovery.jwks_uri);
		return verifyIdToken(idToken, jwks, expected);
	}
}

async function fetchUserinfo(d: Discovery, accessToken: string) {
	const res = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
	if (!res.ok) throw new Error(`userinfo: ${res.status}`);
	return (await res.json()) as Record<string, unknown>;
}

// ---- 画面 ----
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const time = (s?: number) => (s ? new Date(s * 1000).toISOString() : '-');
const layout = (body: string) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>demo-app</title>
<style>body{font-family:system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;line-height:1.6}
pre{background:#f4f4f4;padding:.75rem;overflow-x:auto}th{text-align:left;padding-right:1rem}button,a.button{font-size:1rem;padding:.5rem 1rem}</style>
</head><body><h1>demo-app</h1>${body}</body></html>`;

const loginPage = () => layout(`<p>ログインしていません。</p><p><a class="button" href="/login">auth でログイン</a></p>`);

const homePage = ({ claims, userinfo }: Session) =>
	layout(`<p>ようこそ、${esc(String(claims.preferred_username ?? claims.sub))} さん。</p>
<table>
<tr><th>sub（利用者の ID）</th><td>${esc(claims.sub)}</td></tr>
<tr><th>amr（ログインの方法）</th><td>${esc((claims.amr ?? []).join(' '))}</td></tr>
<tr><th>auth_time（auth でログインした時刻）</th><td>${time(claims.auth_time)}</td></tr>
<tr><th>iat（ID トークンを作った時刻）</th><td>${time(claims.iat)}</td></tr>
</table>
<h2>ID トークンの中身</h2><pre>${esc(JSON.stringify(claims, null, 2))}</pre>
<h2>/userinfo の返事</h2><pre>${esc(JSON.stringify(userinfo, null, 2))}</pre>
<form method="post" action="/logout"><button>ログアウト（demo-app だけ）</button></form>`);

const errorPage = (message: string) => layout(`<p>${esc(message)}</p><p><a href="/">トップへ</a></p>`);

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, (info) => console.log(`demo-app listening on :${info.port}`));
