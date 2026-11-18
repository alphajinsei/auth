// アクセストークン（JWT）。auth が作ったものを、/userinfo と同じ関数で、DB なしで確かめられること（ステップ5の要素②③）
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.OIDC_SIGNING_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
const { issueAccessToken, verifyAccessToken, ACCESS_TOKEN_TTL_S } = await import('../src/access-token.js');
const { signJwt } = await import('../src/jwt.js');

const iss = 'https://auth.example';
const now = 1_800_000_000;
const token = issueAccessToken({ issuer: iss, sub: 'u1', clientId: 'demo-app', scope: 'openid profile' }, now);

test('an access token has typ at+jwt and the RFC 9068 claims', () => {
	const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
	assert.equal(header.typ, 'at+jwt');
	const c = verifyAccessToken(token, iss, now);
	assert.equal(c.sub, 'u1');
	assert.equal(c.aud, iss);
	assert.equal(c.client_id, 'demo-app');
	assert.equal(c.scope, 'openid profile');
	assert.equal(c.exp - c.iat, ACCESS_TOKEN_TTL_S);
	assert.match(c.jti, /^[A-Za-z0-9_-]{22}$/);
});

test('rejects an expired token, another issuer, and a tampered payload', () => {
	assert.throws(() => verifyAccessToken(token, iss, now + ACCESS_TOKEN_TTL_S + 61), /expired/);
	assert.throws(() => verifyAccessToken(token, 'https://evil.example', now), /iss mismatch/);
	const [h, p, s] = token.split('.');
	const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
	const forged = Buffer.from(JSON.stringify({ ...claims, scope: 'openid profile admin' })).toString('base64url');
	assert.throws(() => verifyAccessToken(`${h}.${forged}.${s}`, iss, now), /bad signature/);
	assert.throws(() => verifyAccessToken('abc.def.ghi', iss, now), /not a JWT/);
});

test('an ID token (typ JWT) cannot be used as an access token, even with the same key', () => {
	const idToken = signJwt({ iss, sub: 'u1', aud: 'demo-app', iat: now, exp: now + 600 });
	assert.throws(() => verifyAccessToken(idToken, iss, now), /unexpected typ/);
	// typ を at+jwt にしても、aud が client（ID トークンの形）なら通らない
	const disguised = signJwt({ iss, sub: 'u1', aud: 'demo-app', client_id: 'demo-app', scope: 'openid', iat: now, exp: now + 600 }, 'at+jwt');
	assert.throws(() => verifyAccessToken(disguised, iss, now), /aud mismatch/);
});
