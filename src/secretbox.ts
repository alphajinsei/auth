// TOTP の秘密を、DB に置く前に暗号化する（AES-256-GCM）。
// 鍵は環境変数 TOTP_KEY（32バイトを base64 で）。本番は Vault → デプロイのときに .env、手元は local.env（開発用で秘密ではない）。
// 何をどこに置くかの整理：docs/notes/study-notes.md の「TOTP の秘密を暗号化して保存するとき、何がどこに置かれるのか」
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const keyBase64 = process.env.TOTP_KEY;
if (!keyBase64) throw new Error('TOTP_KEY is not set');
const key = Buffer.from(keyBase64, 'base64');
if (key.length !== 32) throw new Error('TOTP_KEY must be 32 bytes (base64)');

// 暗号文の形：base64url( nonce 12バイト | 暗号文 | 認証タグ 16バイト )
//
// - GCM は、暗号化と同時に「改ざんされていないか」を確かめるタグを作る方式（認証付き暗号）。
//   DB の値を書き換えられたら、復号のときにエラーになる。
// - nonce（一度だけ使う乱数）は、暗号化のたびに作る。同じ鍵で nonce を使い回すと、GCM は安全でなくなる。
// - aad（追加の認証データ）に利用者の ID を渡す。暗号化はしないが、タグの計算に混ぜる。
//   別の利用者の行に暗号文をそのまま写しても、ID が違うので復号できない。
export function seal(plain: Buffer, aad: string): string {
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(Buffer.from(aad));
	const body = Buffer.concat([cipher.update(plain), cipher.final()]);
	return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url');
}

export function open(sealed: string, aad: string): Buffer {
	const data = Buffer.from(sealed, 'base64url');
	const nonce = data.subarray(0, 12);
	const tag = data.subarray(data.length - 16);
	const body = data.subarray(12, data.length - 16);
	const decipher = createDecipheriv('aes-256-gcm', key, nonce);
	decipher.setAAD(Buffer.from(aad));
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(body), decipher.final()]); // タグが合わなければ、ここで例外
}
