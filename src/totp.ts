// TOTP（RFC 6238）と、その元になる HOTP（RFC 4226）。計算はここで自分で書き、HMAC そのものだけ node:crypto に任せる。
// 背景：docs/notes/extra-history-otp.md、流れ：docs/steps/2-totp.md
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30; // 時刻を30秒ごとの枠に区切る
const DIGITS = 6;

// 利用者ごとの秘密。20バイト（160ビット）は、HMAC-SHA1 の出力と同じ長さで、RFC 4226 の推奨
export function generateSecret(): Buffer {
	return randomBytes(20);
}

// HOTP：HMAC(秘密, カウンタ) から、決まった桁数の数字を切り出す
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
	// カウンタは 8バイトのビッグエンディアン
	const message = Buffer.alloc(8);
	message.writeBigUInt64BE(BigInt(counter));
	const mac = createHmac('sha1', secret).update(message).digest(); // 20バイト

	// dynamic truncation：最後のバイトの下位4ビットで、切り出す位置（0〜15）を決める。
	// 位置を固定しないのは、20バイトのどこから取っても偏りが出ないようにするため
	const offset = mac[mac.length - 1] & 0x0f;
	// そこから4バイトを読み、最上位ビットを捨てて 31ビットの正の整数にする（符号の扱いの違いを避ける）
	const binary = mac.readUInt32BE(offset) & 0x7fffffff;

	return String(binary % 10 ** digits).padStart(digits, '0');
}

// 時刻（ミリ秒）→ 30秒ごとの枠の番号。TOTP は、この番号を HOTP のカウンタとして使うだけ
export function stepAt(ms: number): number {
	return Math.floor(ms / 1000 / STEP_SECONDS);
}

export function totp(secret: Buffer, ms = Date.now(), digits = DIGITS): string {
	return hotp(secret, stepAt(ms), digits);
}

// 入力された6桁を照らす。合えば、合った枠の番号を返す（呼び出し側が「最後に使った枠」として記録する）。
// - 前後1つの枠（±30秒）まで許す：入力している間の時間の経過と、時計のずれのため
// - lastStep 以前の枠は拒む：同じ6桁を2回使わせない（RFC 6238）
export function verifyTotp(secret: Buffer, code: string, lastStep: number | null, ms = Date.now()): number | null {
	if (!/^\d{6}$/.test(code)) return null;
	const now = stepAt(ms);
	for (const step of [now - 1, now, now + 1]) {
		if (lastStep !== null && step <= lastStep) continue;
		// 秘密に由来する値の比較は、時間が一定の関数で行う（何文字目まで合ったかを、応答時間から推測させない）
		if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) return step;
	}
	return null;
}

// ---- 登録の QR に入れる URL ----

// Base32（RFC 4648）。認証アプリは、秘密をこの形式で受け取る（人が手で打つこともあるので、紛らわしい文字のない32文字）
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Buffer): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
	return out; // 末尾の = は付けない（otpauth の URL では省くのが慣例）
}

// Google が決めた書き方（Key Uri Format）。どの認証アプリも、この URL の QR を読める
//   otpauth://totp/<発行者>:<アカウント>?secret=<Base32>&issuer=<発行者>
export function otpauthUri(secret: Buffer, account: string, issuer: string): string {
	const label = encodeURIComponent(`${issuer}:${account}`);
	const params = new URLSearchParams({ secret: base32(secret), issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
	return `otpauth://totp/${label}?${params}`;
}
