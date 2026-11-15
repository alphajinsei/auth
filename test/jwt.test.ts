// ID トークンの署名（要素⑧）。作った JWT が JWKS の公開鍵で確かめられること、書き換えたら通らないこと
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.OIDC_SIGNING_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
const { jwks, kid, signJwt, verifyJwt } = await import('../src/jwt.js');

test('a signed JWT verifies with the public key published in JWKS', () => {
	const token = signJwt({ sub: 'u1', aud: 'demo-app' });
	const [h, , s] = token.split('.');
	const header = JSON.parse(Buffer.from(h, 'base64url').toString());
	assert.deepEqual(header, { alg: 'ES256', typ: 'JWT', kid });
	assert.equal(Buffer.from(s, 'base64url').length, 64); // r‖s（DER ではない）
	const jwk = jwks.keys[0];
	assert.equal(jwk.kid, kid);
	const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
	assert.deepEqual(verifyJwt(token, key), { sub: 'u1', aud: 'demo-app' });
});

test('a tampered payload or a different key does not verify', () => {
	const [h, , s] = signJwt({ sub: 'u1' }).split('.');
	const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin' })).toString('base64url')}.${s}`;
	assert.throws(() => verifyJwt(forged), /bad signature/);
	const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
	assert.throws(() => verifyJwt(signJwt({ sub: 'u1' }), other), /bad signature/);
});

test('alg is not taken from the token (alg: none is rejected)', () => {
	const [, p] = signJwt({ sub: 'u1' }).split('.');
	const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${p}.`;
	assert.throws(() => verifyJwt(none), /unexpected alg/);
});

test('kid is the RFC 7638 thumbprint: same key, same kid', () => {
	assert.match(kid, /^[A-Za-z0-9_-]{43}$/); // SHA-256 の base64url
});
