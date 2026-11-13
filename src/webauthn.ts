// WebAuthn の RP サーバーの中心：challenge、options、ブラウザから返ってきたものの確認。
// 登録とログインの両方で使う（ログインは 3-b）
// ライブラリ（@simplewebauthn/server）は、CBOR やバイト列の分解にだけ使う。確かめるのは全部ここ
// 番号の読み方（docs/steps/3-passkey.md）
//   「登録 7」   ＝ 図「登録」の 7 番の矢印（図の丸数字。Note には番号がないので「登録 7 のあとの Note」と書く）
//   「ログイン 7」＝ 図「ログイン」の 7 番の矢印
//   「要素③」   ＝ 「1. 技術の要素」の表の ③
// どの関数が図のどこに当たるかの一覧は、文書の各図の下の「図とコードの対応」の表
import { createHash, createPublicKey, randomBytes, type KeyObject } from 'node:crypto';
import { decodeAttestationObject, decodeCredentialPublicKey, parseAuthenticatorData } from '@simplewebauthn/server/helpers';

// RP ID：鍵を結び付けるドメイン（要素④）。自分の origin のホスト名（本番 auth.alphajinsei.com、手元 localhost）
export const origin = process.env.PUBLIC_ORIGIN!;
export const rpId = new URL(origin).hostname;
const RP_NAME = 'auth';

// 受け付ける署名の方式（COSE の番号）。ES256 がほとんどの認証器、RS256 は Windows Hello の一部
const ES256 = -7;
const RS256 = -257;

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

// 登録 2 のあとの Note ／ ログイン 2 のあとの Note（challenge を作る）
// 要素② challenge：毎回の乱数。これを含めて署名させるので、前の応答の使い回しが通らない
export const newChallenge = () => randomBytes(32).toString('base64url');

// 登録 3：options の中身。ブラウザは PublicKeyCredential.parseCreationOptionsFromJSON でこれを読む
export function registrationOptions(
	user: { id: string; username: string },
	challenge: string,
	existing: { id: string; transports: string | null }[],
) {
	return {
		rp: { id: rpId, name: RP_NAME },
		// user handle：認証器に保存され、ログインのときに返ってくる。個人情報を入れないのが決まりなので、UUID を使う
		user: { id: b64url(Buffer.from(user.id)), name: user.username, displayName: user.username },
		challenge,
		pubKeyCredParams: [
			{ type: 'public-key', alg: ES256 },
			{ type: 'public-key', alg: RS256 },
		],
		timeout: 5 * 60 * 1000,
		attestation: 'none', // 認証器の製造元の証明は求めない
		authenticatorSelection: {
			residentKey: 'required', // discoverable：ユーザー名を入れずにログインできるよう、認証器に鍵を覚えさせる
			userVerification: 'required', // 要素⑤ 指紋・PIN を必ず求める（パスキー1つで多要素にするため）
		},
		// 登録済みの鍵。同じ認証器が2つ目を作ろうとすると、認証器が断る
		excludeCredentials: existing.map((c) => ({
			type: 'public-key',
			id: c.id,
			...(c.transports ? { transports: c.transports.split(' ') } : {}),
		})),
	};
}

// 登録 7 のあとの 1つ目の Note ／ ログイン 8 のあとの 1つ目の Note：clientDataJSON（ブラウザが作る）を確かめる
// 要素②③：種類・challenge・origin。origin はブラウザが書き込むので、ページの JavaScript には偽れない
export function checkClientData(clientDataJSON: string, type: 'webauthn.create' | 'webauthn.get', challenge: string) {
	const raw = Buffer.from(clientDataJSON, 'base64url');
	const data = JSON.parse(raw.toString('utf8'));
	if (data.type !== type) throw new Error(`clientData type ${data.type}`);
	if (data.challenge !== challenge) throw new Error('challenge mismatch');
	if (data.origin !== origin) throw new Error(`origin ${data.origin}`); // 偽サイトで操作すると、ここで落ちる
	if (data.crossOrigin === true) throw new Error('cross origin'); // よそのページに iframe で埋め込まれた操作
	return raw; // ログインの署名の検証で、このバイト列のハッシュを使う
}

// 登録 7 のあとの 2つ目の Note の後半 ／ ログイン 8 のあとの 2つ目の Note：authenticatorData（認証器が作る）を確かめる
export function checkAuthData(authData: Uint8Array<ArrayBuffer>) {
	const parsed = parseAuthenticatorData(authData);
	// 要素④ RP ID のハッシュ：認証器が「どのサイトの鍵として使ったか」。自分の RP ID でなければ拒む
	if (!sha256(rpId).equals(Buffer.from(parsed.rpIdHash))) throw new Error('rpIdHash mismatch');
	if (!parsed.flags.up) throw new Error('user not present'); // UP：その場で操作した（タッチなど）
	if (!parsed.flags.uv) throw new Error('user not verified'); // UV：要素⑤ 指紋・PIN で本人を確かめた
	return parsed;
}

// 登録 7 のあとの Note 2つ：ブラウザから返ってきた登録の応答を確かめ、保存するもの（登録 8）を取り出す
// body は credential.toJSON() の形（バイト列はすべて base64url）
export function verifyRegistration(body: any, challenge: string) {
	if (body?.type !== 'public-key') throw new Error('bad credential type');
	checkClientData(body.response.clientDataJSON, 'webauthn.create', challenge);

	// attestationObject は CBOR：{ fmt, attStmt, authData }。attestation は none を頼んだので、attStmt は見ない
	const att = decodeAttestationObject(Buffer.from(body.response.attestationObject, 'base64url'));
	const auth = checkAuthData(att.get('authData'));
	if (!auth.flags.at || !auth.credentialID || !auth.credentialPublicKey) throw new Error('no attested credential');

	// authenticatorData の中の鍵の ID が、ブラウザが渡してきた ID と同じか
	const id = b64url(auth.credentialID);
	if (id !== body.id) throw new Error('credential id mismatch');

	// 要素① 公開鍵：受け付ける方式か、Node.js の鍵として読めるかを、登録の時点で確かめておく
	coseToKey(auth.credentialPublicKey);

	return {
		id,
		publicKey: b64url(auth.credentialPublicKey), // COSE のまま保存する
		signCount: auth.counter, // 要素⑦
		transports: Array.isArray(body.response.transports) ? body.response.transports.join(' ') : null,
	};
}

// 登録 7 のあとの 2つ目の Note（登録の時点の確認）／ ログイン 8 のあとの 3つ目の Note（署名の検証）で使う。
// COSE（CBOR の Map。キーは番号）の公開鍵を、Node.js の鍵（JWK 経由）に直す
// 番号は RFC 9053：1=kty、3=alg、EC2 は -1=crv、-2=x、-3=y、RSA は -1=n、-2=e
export function coseToKey(cose: Uint8Array<ArrayBuffer>): { key: KeyObject; alg: number } {
	const m = decodeCredentialPublicKey(cose) as unknown as Map<number, any>;
	const kty = m.get(1);
	const alg = m.get(3);
	if (alg === ES256 && kty === 2 && m.get(-1) === 1) {
		// kty 2 = EC2、crv 1 = P-256
		const jwk = { kty: 'EC', crv: 'P-256', x: b64url(m.get(-2)), y: b64url(m.get(-3)) };
		return { key: createPublicKey({ key: jwk, format: 'jwk' }), alg };
	}
	if (alg === RS256 && kty === 3) {
		// kty 3 = RSA
		const jwk = { kty: 'RSA', n: b64url(m.get(-1)), e: b64url(m.get(-2)) };
		return { key: createPublicKey({ key: jwk, format: 'jwk' }), alg };
	}
	throw new Error(`unsupported key: kty ${kty}, alg ${alg}`);
}
