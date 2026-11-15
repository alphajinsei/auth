// ID トークン（JWT）に署名する鍵と、JWT を作る関数。流れ：docs/steps/4-oidc.md
// 番号の読み方は src/webauthn.ts と同じ（「ログイン 13」＝ 4-oidc.md の図「ログイン」の 13 番の矢印、「要素⑧」＝「1. 技術の要素」の ⑧）
//
// JWT ＝ base64url(ヘッダー) . base64url(中身) . base64url(署名)
//   署名の対象は「base64url(ヘッダー) . base64url(中身)」の文字列そのもの（JSON を並べ直したりしない）
import { createHash, createPrivateKey, createPublicKey, sign, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

// 鍵は環境変数 OIDC_SIGNING_KEY（PKCS#8 の PEM を base64 で）。本番は Vault → デプロイのときに .env、手元は local.env（開発用）
const keyBase64 = process.env.OIDC_SIGNING_KEY;
if (!keyBase64) throw new Error('OIDC_SIGNING_KEY is not set');
const privateKey = createPrivateKey(Buffer.from(keyBase64, 'base64').toString('utf8'));
if (privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('OIDC_SIGNING_KEY must be a P-256 key');

// 公開鍵（JWK の形）。秘密鍵から作る。秘密の部分（d）は含まない
const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' }) as JsonWebKey & { x: string; y: string };

// kid（鍵の ID）：公開鍵の「指紋」（JWK Thumbprint、RFC 7638）。
// 必須の項目だけを、決まった順（名前の辞書順）で、空白なしの JSON にして SHA-256。鍵が同じなら、誰が計算しても同じ値になる
export const kid = createHash('sha256')
	.update(JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y }))
	.digest('base64url');

// 準備 4（JWKS）：RP（demo-app）に公開する鍵の一覧。鍵を入れ替えるときは、ここに新旧の2つを並べる
export const jwks = {
	keys: [{ kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y, kid, use: 'sig', alg: 'ES256' }],
};

const b64json = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ログイン 12 のあとの 2つ目の Note：JWT を作って署名する（要素⑧）
export function signJwt(payload: Record<string, unknown>): string {
	const signingInput = `${b64json({ alg: 'ES256', typ: 'JWT', kid })}.${b64json(payload)}`;
	// ieee-p1363：署名を r と s を32バイトずつ並べた64バイトにする（JWS の ES256 の決まり、RFC 7518）。
	// Node.js の既定は DER（ASN.1）で、段3の WebAuthn の署名はそちらだった。同じ ES256 でも、入れ物の形が違う
	const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
	return `${signingInput}.${signature.toString('base64url')}`;
}

// 署名を確かめて、中身を返す（テスト用。demo-app は自分で同じことを書く）
export function verifyJwt(token: string, key: KeyObject = createPublicKey(privateKey)): Record<string, unknown> {
	const [h, p, s] = token.split('.');
	const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
	if (header.alg !== 'ES256') throw new Error(`unexpected alg ${header.alg}`); // alg を相手の言い値にしない
	const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
	if (!ok) throw new Error('bad signature');
	return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
}
