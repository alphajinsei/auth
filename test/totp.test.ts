// RFC に載っているテスト値で、計算が正しいことを確かめる。npm test で流す
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32, hotp, totp, verifyTotp } from '../src/totp.js';

// RFC 4226 の付録 D と RFC 6238 の付録 B で使われている秘密（ASCII の "12345678901234567890"）
const secret = Buffer.from('12345678901234567890', 'ascii');

test('HOTP: RFC 4226 Appendix D (counter 0-9, 6 digits)', () => {
	const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
	expected.forEach((code, counter) => assert.equal(hotp(secret, counter), code));
});

test('TOTP: RFC 6238 Appendix B (SHA-1, 8 digits)', () => {
	const cases: [number, string][] = [
		[59, '94287082'],
		[1111111109, '07081804'],
		[1111111111, '14050471'],
		[1234567890, '89005924'],
		[2000000000, '69279037'],
		[20000000000, '65353130'],
	];
	for (const [seconds, code] of cases) assert.equal(totp(secret, seconds * 1000, 8), code);
});

test('verify: accepts the previous, current and next step, nothing further', () => {
	const now = 1_800_000_000_000; // 枠のちょうど境目ではない適当な時刻
	const at = (offsetSeconds: number) => totp(secret, now + offsetSeconds * 1000);
	assert.notEqual(verifyTotp(secret, at(0), null, now), null);
	assert.notEqual(verifyTotp(secret, at(-30), null, now), null);
	assert.notEqual(verifyTotp(secret, at(30), null, now), null);
	assert.equal(verifyTotp(secret, at(-90), null, now), null);
	assert.equal(verifyTotp(secret, at(90), null, now), null);
});

test('verify: rejects reuse of the same step', () => {
	const now = 1_800_000_000_000;
	const code = totp(secret, now);
	const step = verifyTotp(secret, code, null, now);
	assert.notEqual(step, null);
	assert.equal(verifyTotp(secret, code, step, now), null); // 同じ6桁をもう一度
});

test('verify: rejects malformed input', () => {
	assert.equal(verifyTotp(secret, '12345', null), null);
	assert.equal(verifyTotp(secret, 'abcdef', null), null);
});

test('base32: RFC 4648 test vectors (without padding)', () => {
	const cases: [string, string][] = [
		['', ''],
		['f', 'MY'],
		['fo', 'MZXQ'],
		['foo', 'MZXW6'],
		['foob', 'MZXW6YQ'],
		['fooba', 'MZXW6YTB'],
		['foobar', 'MZXW6YTBOI'],
	];
	for (const [input, output] of cases) assert.equal(base32(Buffer.from(input)), output);
});
