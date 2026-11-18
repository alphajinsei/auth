// demo-app：auth でログインする、小さな RP。流れ：docs/steps/4-oidc.md の図「ログイン」の 1〜3、10〜14
// ステップ5（docs/steps/5-tokens.md）：トークンをセッションに持ち、/userinfo を呼ぶ。期限切れならリフレッシュ（図「期限切れとリフレッシュ」）、
// ログアウトで /revoke（図「ログアウトと取り消し」）。「盗難のまね」のボタンで、図「盗難の検知」も試せる
// ステップ5で独立したリポジトリにするまでの仮住まい。DB は持たない（セッションはメモリに置き、再起動で消える）
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

// ステップ5：トークンもセッションに持つ。ブラウザ（Cookie）には渡さない。demo-app のサーバーの中だけに置く
type Tokens = { access: string; refresh: string; accessExpiresAt: number }; // accessExpiresAt：秒（expires_in から計算）
type Session = {
	claims: IdTokenClaims;
	userinfo: Record<string, unknown>;
	tokens: Tokens;
	previousRefresh?: string; // 取り替えで使用済みになった、1つ前のリフレッシュトークン。「盗難のまね」のボタンのためだけに覚える
	refreshing?: Promise<RefreshResult>; // リフレッシュ中なら、その約束。同時に2回リフレッシュしない（docs/steps/5-tokens.md の 3 節）
	events: { at: number; text: string }[]; // 画面に出す、何が起きたかの記録
};
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

		// ログイン 14：demo-app のセッションを作る。ログインし直さずに続けられるのは、リフレッシュトークンが続く間（系統の期限は30日）
		const id = randomBytes(32).toString('base64url');
		const session: Session = { claims, userinfo, tokens: toTokens(tokens), events: [] };
		log(session, 'ログインした。アクセストークンとリフレッシュトークンを受け取った');
		sessions.set(id, session);
		setCookie(c, SESSION_COOKIE, id, { ...cookieOpts, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 });
		return c.redirect('/', 303);
	} catch (e) {
		console.error(e);
		return c.html(errorPage(`ログインできませんでした：${(e as Error).message}`), 400);
	}
});

// 「/userinfo を呼ぶ」：図「期限切れとリフレッシュ」の流れ。401 ならリフレッシュして、1回だけやり直す
app.post('/call', async (c) => {
	const id = getCookie(c, SESSION_COOKIE) ?? '';
	const session = sessions.get(id);
	if (!session) return c.redirect('/', 303);
	const { discovery } = await config();

	// リフレッシュ 1：GET /userinfo（Bearer アクセストークン）
	let res = await callUserinfo(discovery, session.tokens.access);
	if (res.status === 401) {
		// リフレッシュ 2：401。理由は WWW-Authenticate に入っている（期限切れなら error_description="expired"）
		log(session, `/userinfo が 401 を返した（${res.headers.get('www-authenticate') ?? ''}）。リフレッシュする`);
		const refreshed = await refresh(discovery, session);
		if (!refreshed.ok) return loggedOut(c, id, `リフレッシュできませんでした（${refreshed.error}）。ログインし直してください`);
		// リフレッシュ 8：新しいアクセストークンで、もう一度
		res = await callUserinfo(discovery, session.tokens.access);
	}
	if (!res.ok) {
		log(session, `/userinfo が ${res.status} を返した`);
		return c.redirect('/', 303);
	}
	// リフレッシュ 9 ／ API 3：sub がログインのときの ID トークンと同じか（OIDC Core 5.3.2）
	const userinfo = (await res.json()) as Record<string, unknown>;
	if (userinfo.sub !== session.claims.sub) return loggedOut(c, id, 'userinfo の sub が ID トークンと一致しません');
	session.userinfo = userinfo;
	log(session, '/userinfo を呼んだ（200）');
	return c.redirect('/', 303);
});

// 「盗難のまね」：使用済みの、1つ前のリフレッシュトークンを auth に出す。図「盗難の検知」の 4〜7 を、攻撃者の代わりに demo-app がやる。
// auth は「使用済みが来た」と見て、系統ごと消す。そのあと「/userinfo を呼ぶ」で期限切れになると、今のリフレッシュトークンも通らない（盗難 8〜10）
app.post('/replay', async (c) => {
	const session = sessions.get(getCookie(c, SESSION_COOKIE) ?? '');
	if (!session?.previousRefresh) return c.redirect('/', 303);
	const { discovery } = await config();
	const res = await tokenRequest(discovery.token_endpoint, { grant_type: 'refresh_token', refresh_token: session.previousRefresh });
	log(session, `盗難のまね：使用済みのリフレッシュトークンを出した → ${res.status} ${res.body.error ?? ''} ${res.body.error_description ?? ''}`);
	return c.redirect('/', 303);
});

// ログアウト：ログアウト 3 → 5 で、auth にリフレッシュトークンを取り消してもらってから、demo-app のセッションを消す。
// auth のセッションは残るので、もう一度ログインすると、auth の画面を通らずに戻ってくる（図「2つ目以降のログイン」。
// auth からもログアウトさせる仕組みは、OIDC の別の仕様で、今回は作らない）
app.post('/logout', async (c) => {
	const id = getCookie(c, SESSION_COOKIE) ?? '';
	const session = sessions.get(id);
	if (session) {
		const { discovery } = await config();
		// 取り消せなくても（auth が落ちている、など）ログアウトは続ける。リフレッシュトークンは期限で切れる
		if (discovery.revocation_endpoint) {
			const res = await formPost(discovery.revocation_endpoint, { token: session.tokens.refresh }).catch((e: Error) => e);
			if (res instanceof Error || !res.ok) console.error('revoke failed', res instanceof Error ? res.message : res.status);
		}
	}
	sessions.delete(id);
	deleteCookie(c, SESSION_COOKIE, cookieOpts);
	return c.redirect('/', 303);
});

// リフレッシュできなかった（盗難として系統が消された、期限切れ、同意の取り消し）：demo-app のセッションを消して、ログインし直してもらう
function loggedOut(c: Context, id: string, message: string) {
	sessions.delete(id);
	deleteCookie(c, SESSION_COOKIE, cookieOpts);
	return c.html(errorPage(message), 401);
}

// ---- auth との裏の通信 ----

// client_secret_basic：client_id と client_secret を URL エンコードしてから「:」でつなぎ、base64（RFC 6749 2.3.1）
const basic = Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64');

// /token と /revoke の共通：client の認証を付けて、フォームの形で POST する
function formPost(url: string, params: Record<string, string>) {
	return fetch(url, {
		method: 'POST',
		headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params),
	});
}

type TokenBody = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	id_token?: string;
	error?: string;
	error_description?: string;
};
async function tokenRequest(url: string, params: Record<string, string>) {
	const res = await formPost(url, params);
	return { ok: res.ok, status: res.status, body: (await res.json()) as TokenBody };
}

const toTokens = (b: { access_token: string; refresh_token: string; expires_in: number }): Tokens => ({
	access: b.access_token,
	refresh: b.refresh_token,
	accessExpiresAt: Math.floor(Date.now() / 1000) + b.expires_in,
});

// ログイン 11 → 13：認可コードを、ID トークン、アクセストークン、リフレッシュトークンに引き換える
async function exchangeCode(d: Discovery, code: string, verifier: string) {
	const { ok, body } = await tokenRequest(d.token_endpoint, {
		grant_type: 'authorization_code',
		code,
		redirect_uri: REDIRECT_URI,
		code_verifier: verifier,
	});
	if (!ok || !body.id_token || !body.access_token || !body.refresh_token || !body.expires_in) {
		throw new Error(`token: ${body.error} ${body.error_description ?? ''}`);
	}
	return { id_token: body.id_token, access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in };
}

type RefreshResult = { ok: true } | { ok: false; error: string };

// リフレッシュ 3 → 7：リフレッシュトークンで、新しいアクセストークンと、新しいリフレッシュトークンをもらう（取り替え）。
// 同じセッションで同時に呼ばれたら、2回目は1回目の結果を待つ（同じトークンを2回出すと、auth は盗難と見なして系統ごと消す）
function refresh(d: Discovery, session: Session): Promise<RefreshResult> {
	session.refreshing ??= (async (): Promise<RefreshResult> => {
		const used = session.tokens.refresh;
		const { ok, body } = await tokenRequest(d.token_endpoint, { grant_type: 'refresh_token', refresh_token: used });
		if (!ok || !body.access_token || !body.refresh_token || !body.expires_in) {
			log(session, `リフレッシュに失敗した（${body.error} ${body.error_description ?? ''}）`);
			return { ok: false, error: `${body.error ?? 'error'}` };
		}
		// リフレッシュ 7 のあとの Note：2つとも入れ替える。古いリフレッシュトークンは、auth の側でもう使用済み
		session.tokens = toTokens({ access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in });
		session.previousRefresh = used;
		log(session, 'リフレッシュした。新しいアクセストークンと、新しいリフレッシュトークンに入れ替えた');
		return { ok: true };
	})().finally(() => {
		session.refreshing = undefined;
	});
	return session.refreshing;
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

const callUserinfo = (d: Discovery, accessToken: string) =>
	fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });

async function fetchUserinfo(d: Discovery, accessToken: string) {
	const res = await callUserinfo(d, accessToken);
	if (!res.ok) throw new Error(`userinfo: ${res.status}`);
	return (await res.json()) as Record<string, unknown>;
}

function log(session: Session, text: string) {
	session.events.unshift({ at: Math.floor(Date.now() / 1000), text });
	session.events.length = Math.min(session.events.length, 10);
}

// アクセストークン（JWT）の中身を、画面に出すためだけに読む。署名は確かめない（確かめるのは API の仕事。demo-app にとっては、ただの文字列）
const peek = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;

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

const homePage = ({ claims, userinfo, tokens, previousRefresh, events }: Session) => {
	const left = tokens.accessExpiresAt - Math.floor(Date.now() / 1000);
	return layout(`<p>ようこそ、${esc(String(claims.preferred_username ?? claims.sub))} さん。</p>
<table>
<tr><th>sub（利用者の ID）</th><td>${esc(claims.sub)}</td></tr>
<tr><th>amr（ログインの方法）</th><td>${esc((claims.amr ?? []).join(' '))}</td></tr>
<tr><th>auth_time（auth でログインした時刻）</th><td>${time(claims.auth_time)}</td></tr>
<tr><th>iat（ID トークンを作った時刻）</th><td>${time(claims.iat)}</td></tr>
</table>
<h2>ID トークンの中身</h2><pre>${esc(JSON.stringify(claims, null, 2))}</pre>
<h2>トークン（ステップ5）</h2>
<table>
<tr><th>アクセストークンの期限</th><td>${time(tokens.accessExpiresAt)}（${left > 0 ? `あと ${left} 秒` : `${-left} 秒前に切れた`}。auth は1分の時計のずれを許すので、実際に断られるのはその1分後）</td></tr>
<tr><th>リフレッシュトークン</th><td>${esc(tokens.refresh.slice(0, 8))}…（乱数。中身はない）</td></tr>
</table>
<p>アクセストークンの中身（demo-app は署名を確かめない。確かめるのは API。学ぶために表示しているだけ）：</p>
<pre>${esc(JSON.stringify(peek(tokens.access), null, 2))}</pre>
<form method="post" action="/call"><button>/userinfo を呼ぶ</button>（切れていれば、リフレッシュしてから呼ぶ）</form>
${previousRefresh ? `<form method="post" action="/replay"><button>盗難のまね：1つ前のリフレッシュトークンを出す</button></form>` : ''}
<h2>/userinfo の返事</h2><pre>${esc(JSON.stringify(userinfo, null, 2))}</pre>
<h2>記録（新しい順）</h2>
<ul>${events.map((e) => `<li>${time(e.at)}：${esc(e.text)}</li>`).join('')}</ul>
<form method="post" action="/logout"><button>ログアウト（demo-app のセッションを消し、リフレッシュトークンを取り消す）</button></form>`);
};

const errorPage = (message: string) => layout(`<p>${esc(message)}</p><p><a href="/">トップへ</a></p>`);

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, (info) => console.log(`demo-app listening on :${info.port}`));
