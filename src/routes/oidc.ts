// OIDC の OP（auth）として公開する URL。流れ：docs/steps/4-oidc.md
// 4-a：Discovery と JWKS（図「準備」）。/authorize、/token、/userinfo は 4-b・4-c で足す
import { Hono } from 'hono';
import { jwks } from '../jwt.js';

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
