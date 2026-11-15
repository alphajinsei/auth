// demo-app が ID トークンを確かめる部分（ログイン 13 のあとの Note）。auth の signJwt で作ったものを、demo-app の verifyIdToken で確かめる
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.OIDC_SIGNING_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
const { jwks, signJwt } = await import('../src/jwt.js');
const { verifyIdToken } = await import('../demo-app/src/rp.js');

const now = 1_800_000_000;
const expected = { issuer: 'https://auth.example', clientId: 'demo-app', nonce: 'n1' };
const good = { iss: 'https://auth.example', sub: 'u1', aud: 'demo-app', iat: now, exp: now + 600, nonce: 'n1', amr: ['hwk', 'mfa'] };

test('accepts an ID token signed by auth and addressed to demo-app', () => {
	assert.deepEqual(verifyIdToken(signJwt(good), jwks, expected, now), good);
});

test('rejects wrong iss, aud, nonce, and expired or future tokens', () => {
	const bad = (patch: object) => () => verifyIdToken(signJwt({ ...good, ...patch }), jwks, expected, now);
	assert.throws(bad({ iss: 'https://evil.example' }), /iss mismatch/);
	assert.throws(bad({ aud: 'other-app' }), /aud mismatch/);
	assert.throws(bad({ nonce: 'n2' }), /nonce mismatch/);
	assert.throws(bad({ exp: now - 61 }), /expired/);
	assert.throws(bad({ iat: now + 61 }), /future/);
});

test('rejects a tampered payload, alg "none", and an unknown kid', () => {
	const [h, , s] = signJwt(good).split('.');
	const forged = Buffer.from(JSON.stringify({ ...good, sub: 'admin' })).toString('base64url');
	assert.throws(() => verifyIdToken(`${h}.${forged}.${s}`, jwks, expected, now), /bad signature/);

	const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
	assert.throws(() => verifyIdToken(`${none}.${forged}.x`, jwks, expected, now), /unexpected alg/);

	const otherKid = { keys: jwks.keys.map((k) => ({ ...k, kid: 'rotated' })) };
	assert.throws(() => verifyIdToken(signJwt(good), otherKid, expected, now), /unknown kid/);
});
