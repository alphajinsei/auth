// アクセストークン（JWT）を作る・確かめる。流れ：docs/steps/5-tokens.md
// 番号の読み方は src/webauthn.ts と同じ（「要素②」＝ 5-tokens.md の「1. 技術の要素」の ②、「API 1」＝図「API を呼ぶ」の 1 番の矢印）
// HTTP にも DB にも触らない計算だけを置く。/token と /userinfo（src/routes/oidc.ts）から使う
import { randomBytes } from 'node:crypto';
import { kid, signJwt, verifyJwt } from './jwt.js';

export const ACCESS_TOKEN_TTL_S = 5 * 60; // 要素①：短命。取り消しが効かない幅を、この長さに収める
const TYP = 'at+jwt'; // RFC 9068 2.1
const SKEW_S = 60; // 時計のずれの許し。auth の中で作って auth の中で確かめる今は要らないが、API が別のサーバーになったときのために

export type AccessTokenClaims = {
	iss: string;
	sub: string; // 利用者の ID（ID トークンの sub と同じ）
	aud: string; // どの API 宛てか。今は auth の issuer（API は auth の /userinfo だけ）
	client_id: string; // どの client に出したか
	scope: string; // 空白区切り
	iat: number;
	exp: number;
	jti: string; // このトークンの ID（RFC 9068 で必須）。今は使わないが、取り消しの一覧やログで1本を指すのに使える
};

// 要素②：auth が中身を書いて、ID トークンと同じ鍵で署名する
export function issueAccessToken(
	p: { issuer: string; sub: string; clientId: string; scope: string },
	now = Math.floor(Date.now() / 1000),
): string {
	const claims: AccessTokenClaims = {
		iss: p.issuer,
		sub: p.sub,
		aud: p.issuer,
		client_id: p.clientId,
		scope: p.scope,
		iat: now,
		exp: now + ACCESS_TOKEN_TTL_S,
		jti: randomBytes(16).toString('base64url'),
	};
	return signJwt(claims, TYP);
}

// 要素③：API が手元で確かめる。DB もトークンの表も見ない。外れたら理由を投げる（/userinfo が 401 にする）
// 順番は demo-app の verifyIdToken（demo-app/src/rp.ts）と同じ形：形 → 署名 → 中身
export function verifyAccessToken(token: string, issuer: string, now = Math.floor(Date.now() / 1000)): AccessTokenClaims {
	const [h, p, s] = token.split('.');
	if (!h || !p || !s) throw new Error('not a JWT');
	let header;
	try {
		header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
	} catch {
		throw new Error('not a JWT');
	}
	// 投げる文面は /userinfo がそのまま WWW-Authenticate に入れるので、相手が送った値（typ など）を混ぜない
	// API 1 のあとの 1つ目の Note：typ が at+jwt か。ID トークン（typ JWT）を持ち込まれても受けない
	if (header?.typ !== TYP) throw new Error('unexpected typ');
	// kid が今の鍵か（鍵を入れ替えるときは、ここで新旧の両方を受ける）
	if (header.kid !== kid) throw new Error('unknown kid');
	// 署名（alg が ES256 かも verifyJwt が確かめる）。ここを通るまで、中身を信じない
	const claims = verifyJwt(token) as Partial<AccessTokenClaims>;

	// API 1 のあとの 2つ目の Note：iss、aud、exp
	if (claims.iss !== issuer) throw new Error('iss mismatch');
	if (claims.aud !== issuer) throw new Error('aud mismatch'); // 別の API 宛てのトークンを使い回させない
	if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now) throw new Error('expired');
	if (typeof claims.sub !== 'string' || typeof claims.scope !== 'string' || typeof claims.client_id !== 'string') {
		throw new Error('missing claims');
	}
	return claims as AccessTokenClaims;
}
