// 画面。html`...` は埋め込んだ値を自動でエスケープする（ユーザー名に <script> が入っていても、文字として出る）
import { html } from 'hono/html';

const layout = (title: string, body: unknown) => html`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - auth</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;

export const loginPage = (error?: string, username = '') =>
	layout(
		'ログイン',
		html`
    ${error ? html`<p class="error">${error}</p>` : ''}
    <form method="post" action="/login">
      <label>ユーザー名 <input name="username" value="${username}" autocomplete="username" required autofocus></label>
      <label>パスワード <input name="password" type="password" autocomplete="current-password" required></label>
      <button>パスワードでログイン</button>
    </form>
    <p class="or">または</p>
    <button id="passkey-login" type="button">パスキーでログイン</button>
    <p id="passkey-message" class="error-text"></p>
    <script src="/passkey-login.js" defer></script>`,
	);

export type TotpStatus = 'none' | 'pending' | 'enabled';

// amr の値（RFC 8176）を、画面に出す言葉にする
const amrLabel: Record<string, string> = {
	pwd: 'パスワード',
	otp: 'TOTP（ワンタイムパスワード）',
	swk: 'パスキー（同期される鍵）',
	hwk: 'パスキー（端末に固定の鍵）',
	mfa: '多要素',
};

export type PasskeyRow = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null };

// 日時は利用者の地域に関わらず、日本時間で出す（個人のサービスなので）
const jst = (d: Date) => d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });

// アカウントの画面。登録している認証の手段（パスワード、TOTP、パスキー）を並べる
export const accountPage = (a: {
	username: string;
	amr: string;
	hasPassword: boolean;
	totp: TotpStatus;
	passkeys: PasskeyRow[];
	notice?: string;
}) =>
	layout(
		'アカウント',
		html`
    ${a.notice ? html`<p class="notice">${a.notice}</p>` : ''}
    <p>ログイン中：<strong>${a.username}</strong></p>
    <p>このセッションのログイン方法：${a.amr.split(' ').map((m) => amrLabel[m] ?? m).join(' + ')}（amr: <code>${a.amr}</code>）</p>

    <h2>パスワード</h2>
    ${!a.hasPassword
			? html`<p>なし（パスキーだけのアカウント）。</p>`
			: a.passkeys.length
				? html`<p>あり。パスキーがあるので、パスワードを削除してパスキーだけのアカウントにできます（TOTP も一緒に削除します）。</p>
          <form method="post" action="/account/password/delete"><button class="secondary">パスワードを削除</button></form>`
				: html`<p>あり。パスキーを登録すると、パスワードを削除できます。</p>`}

    ${a.hasPassword
			? html`<h2>2段階認証（TOTP）</h2>
    ${a.totp === 'enabled'
				? html`<p>有効。ログインのとき、パスワードのあとに認証アプリの6桁を求めます。</p>
        <form method="post" action="/account/totp/delete"><button class="secondary">TOTP を削除</button></form>`
				: html`<p>${a.totp === 'pending' ? '登録の途中です（確認の6桁がまだ）。' : '未登録。'}</p>
        <form method="post" action="/account/totp/setup"><button>TOTP を登録</button></form>`}`
			: ''}

    <h2>パスキー</h2>
    ${a.passkeys.length
			? html`<ul class="passkeys">
          ${a.passkeys.map(
						(p) => html`<li><strong>${p.name}</strong><br><small>登録 ${jst(p.createdAt)}・最後に使った ${p.lastUsedAt ? jst(p.lastUsedAt) : 'まだ'}</small>
            <form method="post" action="/account/passkey/delete"><input type="hidden" name="id" value="${p.id}"><button class="secondary small">削除</button></form></li>`,
					)}
        </ul>`
			: html`<p>未登録。</p>`}
    <form id="passkey-register">
      <label>名前（どの端末か） <input name="name" maxlength="64" placeholder="iPhone、仕事のパソコン など"></label>
      <button>パスキーを登録</button>
    </form>
    <p id="passkey-message" class="error-text"></p>
    <script src="/passkey-register.js" defer></script>

    <h2>ログアウト</h2>
    <form method="post" action="/logout">
      <button class="secondary">ログアウト</button>
    </form>`,
	);

// ログインの2段目。パスワードが通ったあと、認証アプリの6桁を求める
export const totpLoginPage = (error?: string) =>
	layout(
		'2段階認証',
		html`
    ${error ? html`<p class="error">${error}</p>` : ''}
    <p>認証アプリに出ている6桁を入れてください。</p>
    <form method="post" action="/login/totp">
      <label>6桁 <input name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required autofocus></label>
      <button>ログイン</button>
    </form>`,
	);

// 登録の画面。QR（と、読めないとき用の Base32 の文字列）を見せ、認証アプリに出た6桁で確認する
export const totpSetupPage = (qrDataUrl: string, secretBase32: string, error?: string) =>
	layout(
		'TOTP の登録',
		html`
    ${error ? html`<p class="error">${error}</p>` : ''}
    <ol>
      <li>認証アプリ（Google Authenticator など）で、この QR を読む</li>
      <li>アプリに出た6桁を入れる</li>
    </ol>
    <p><img src="${qrDataUrl}" alt="TOTP の QR コード" width="200" height="200"></p>
    <details><summary>QR を読めないとき</summary><p><code>${secretBase32}</code></p></details>
    <form method="post" action="/account/totp/confirm">
      <label>6桁 <input name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required autofocus></label>
      <button>確認して有効にする</button>
    </form>`,
	);
