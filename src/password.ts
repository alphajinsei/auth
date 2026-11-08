// パスワードのハッシュと照合。計算そのものはライブラリ（argon2）に任せる
import argon2 from 'argon2';

// OWASP の Password Storage Cheat Sheet の推奨の最小値（Argon2id、メモリ 19MiB、2回、並列1）。
// 1回の照合で 19MiB のメモリを使わせる。GPU で大量に並べて総当たりする側には、これが効く
const options = {
	type: argon2.argon2id,
	memoryCost: 19 * 1024, // KiB
	timeCost: 2,
	parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
	// ソルトはライブラリが毎回乱数で作り、結果の文字列の中に埋め込む
	return argon2.hash(password, options);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
	// パラメータとソルトはハッシュの文字列から読むので、ここでは渡さない
	return argon2.verify(hash, password);
}
