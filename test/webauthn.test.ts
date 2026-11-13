// clientDataJSON の確認（②③）。偽サイトの origin、別の challenge、別の種類を拒むこと
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PUBLIC_ORIGIN = 'https://auth.example.com';
const { checkClientData, rpId } = await import('../src/webauthn.js');

const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ok = { type: 'webauthn.create', challenge: 'abc', origin: 'https://auth.example.com', crossOrigin: false };

test('RP ID is the host name of PUBLIC_ORIGIN', () => {
	assert.equal(rpId, 'auth.example.com');
});

test('accepts the expected type, challenge and origin', () => {
	assert.doesNotThrow(() => checkClientData(encode(ok), 'webauthn.create', 'abc'));
});

test('rejects a phishing origin, a different challenge, the wrong type, and cross-origin iframes', () => {
	assert.throws(() => checkClientData(encode({ ...ok, origin: 'https://auth.examp1e.com' }), 'webauthn.create', 'abc'), /origin/);
	assert.throws(() => checkClientData(encode(ok), 'webauthn.create', 'xyz'), /challenge/);
	assert.throws(() => checkClientData(encode(ok), 'webauthn.get', 'abc'), /type/);
	assert.throws(() => checkClientData(encode({ ...ok, crossOrigin: true }), 'webauthn.create', 'abc'), /cross origin/);
});
