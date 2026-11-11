// TOTP の登録と削除（アカウントの画面から）。流れ：docs/steps/2-totp.md の「登録」
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import QRCode from 'qrcode';
import { db } from '../db/client.js';
import { totpCredentials } from '../db/schema.js';
import { open, seal } from '../secretbox.js';
import { currentUser } from '../session.js';
import { base32, generateSecret, otpauthUri, verifyTotp } from '../totp.js';
import { totpSetupPage } from '../views.js';

export const totp = new Hono();

// QR に載せる「発行者」。認証アプリの一覧に、この名前で並ぶ
const issuer = new URL(process.env.PUBLIC_ORIGIN!).host;

// 登録の画面を描く（QR は、秘密から作った otpauth:// の URL を画像にしたもの）
async function renderSetup(secret: Buffer, username: string, error?: string) {
	const qr = await QRCode.toDataURL(otpauthUri(secret, username, issuer));
	return totpSetupPage(qr, base32(secret), error);
}

// 図「登録」の 1〜4：秘密を作って「確認待ち」で保存し、QR を見せる
totp.post('/account/totp/setup', async (c) => {
	const user = await currentUser(c);
	if (!user) return c.redirect('/login', 303);

	const [existing] = await db.select().from(totpCredentials).where(eq(totpCredentials.userId, user.id));
	if (existing?.confirmedAt) return c.redirect('/account', 303); // 有効なものは、削除してから登録し直す

	// 確認待ちのものがあっても、作り直す（前の QR を読み損ねた場合など）
	const secret = generateSecret();
	const sealed = seal(secret, user.id);
	await db
		.insert(totpCredentials)
		.values({ userId: user.id, secret: sealed })
		.onDuplicateKeyUpdate({ set: { secret: sealed, confirmedAt: null, lastStep: null } });

	return c.html(await renderSetup(secret, user.username));
});

// 図「登録」の 7〜：認証アプリに出た6桁で確かめ、合えば有効にする
totp.post('/account/totp/confirm', async (c) => {
	const user = await currentUser(c);
	if (!user) return c.redirect('/login', 303);

	const [cred] = await db.select().from(totpCredentials).where(eq(totpCredentials.userId, user.id));
	if (!cred || cred.confirmedAt) return c.redirect('/account', 303);

	const secret = open(cred.secret, user.id);
	const code = String((await c.req.parseBody()).code ?? '');
	const step = verifyTotp(secret, code, null);
	if (step === null) {
		// 秘密は確認待ちのまま。同じ QR をもう一度見せる（ログイン済みの本人にだけ）
		return c.html(await renderSetup(secret, user.username, '6桁が違います。アプリに今出ている6桁を入れてください'), 400);
	}

	await db.update(totpCredentials).set({ confirmedAt: new Date(), lastStep: step }).where(eq(totpCredentials.userId, user.id));
	return c.redirect('/account?totp=enabled', 303);
});

totp.post('/account/totp/delete', async (c) => {
	const user = await currentUser(c);
	if (!user) return c.redirect('/login', 303);
	await db.delete(totpCredentials).where(eq(totpCredentials.userId, user.id));
	return c.redirect('/account?totp=deleted', 303);
});
