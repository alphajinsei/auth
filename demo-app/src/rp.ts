// demo-app を RP（auth を信じる側）にするための部品。流れ：docs/steps/4-oidc.md
// 番号の読み方は auth の src/webauthn.ts と同じ（「ログイン 13」＝ 4-oidc.md の図「ログイン」の 13 番の矢印、「準備 1」＝図「準備」の 1 番）
// ライブラリ（openid-client など）を使えば数行で済むところを、RP が何を確かめるかを見るために自分で書く
import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

export type Discovery = {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint: string;
	jwks_uri: string;
};
export type Jwks = { keys: (JsonWebKey & { kid: string })[] };
export type IdTokenClaims = {
	iss: string;
	sub: string;
	aud: string | string[];
	exp: number;
	iat: number;
	auth_time?: number;
	nonce?: string;
	amr?: string[];
	preferred_username?: string;
};

// 準備 1 → 2：Discovery。issuer の URL だけを知っていれば、残りの URL はここから読める
export async function discover(issuer: string): Promise<Discovery> {
	const res = await fetch(`${issuer}/.well-known/openid-configuration`);
	if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
	const d = (await res.json()) as Discovery;
	// 中身の issuer が、取りに行った issuer と同じか（OpenID Connect Discovery 1.0 の 4.3）。
	// 違えば、別の OP の設定を読まされている
	if (d.issuer !== issuer) throw new Error(`issuer mismatch: ${d.issuer}`);
	return d;
}

// 準備 3 → 4：JWKS（auth の公開鍵の一覧）
export async function fetchJwks(jwksUri: string): Promise<Jwks> {
	const res = await fetch(jwksUri);
	if (!res.ok) throw new Error(`jwks failed: ${res.status}`);
	return (await res.json()) as Jwks;
}

// ログイン 2 のあとの Note：state、nonce、code_verifier を乱数で作る。code_challenge ＝ SHA-256（code_verifier）
export function newLoginRequest() {
	const verifier = randomBytes(32).toString('base64url'); // 43文字（RFC 7636 は 43〜128文字）
	return {
		state: randomBytes(16).toString('base64url'),
		nonce: randomBytes(16).toString('base64url'),
		verifier,
		challenge: createHash('sha256').update(verifier).digest('base64url'),
	};
}

const SKEW_S = 60; // 時計のずれの許し（auth と demo-app のサーバーの時計は、ぴったりとは合わない）

// ログイン 13 のあとの Note：ID トークンを確かめる（OIDC Core 3.1.3.7 の手順のうち、この流れで要るもの）。
// どれか1つでも外れたら、ログインさせない
export function verifyIdToken(
	token: string,
	jwks: Jwks,
	expected: { issuer: string; clientId: string; nonce: string },
	now = Math.floor(Date.now() / 1000),
): IdTokenClaims {
	const [h, p, s] = token.split('.');
	if (!h || !p || !s) throw new Error('not a JWT');
	const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));

	// 1. 方式は ES256 だけ。ヘッダーの alg を相手の言い値にしない（"none" や、公開鍵を HMAC の鍵に流用させる攻撃がある）
	if (header.alg !== 'ES256') throw new Error(`unexpected alg ${header.alg}`);
	// 2. kid で公開鍵を選ぶ。auth が鍵を入れ替えたら、JWKS に新旧が並ぶ
	const jwk = jwks.keys.find((k) => k.kid === header.kid);
	if (!jwk) throw new Error(`unknown kid ${header.kid}`);
	// 3. 署名。対象は「ヘッダー . 中身」の文字列そのもの。JWS の ES256 は r‖s の64バイト（ieee-p1363）
	const key = createPublicKey({ key: jwk, format: 'jwk' });
	const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
	if (!ok) throw new Error('bad signature');

	// 署名が正しいと分かってから、中身を信じる
	const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as IdTokenClaims;
	// 4. iss：期待した OP が出したか
	if (claims.iss !== expected.issuer) throw new Error(`iss mismatch: ${claims.iss}`);
	// 5. aud：自分宛てか。別の RP 宛ての ID トークンを持ち込まれても受けない
	const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!aud.includes(expected.clientId)) throw new Error(`aud mismatch: ${claims.aud}`);
	// 6. exp：期限内か
	if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now) throw new Error('expired');
	// 7. iat：未来に作られたことになっていないか
	if (typeof claims.iat !== 'number' || claims.iat - SKEW_S > now) throw new Error('issued in the future');
	// 8. nonce（要素⑨）：自分が /login で作って Cookie に覚えた値か。ほかの流れの ID トークンへの差し替えを弾く
	if (claims.nonce !== expected.nonce) throw new Error('nonce mismatch');
	if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('no sub');
	return claims;
}
