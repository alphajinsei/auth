// ブラウザ側（RP アプリケーション）。流れ：docs/steps/3-passkey.md の図「ログイン」
// 番号の読み方
//   「ログイン 7」＝ 図「ログイン」の 7 番の矢印（図の丸数字。Note には番号がないので「ログイン 6 のあとの Note」と書く）
//   「要素③」   ＝ 「1. 技術の要素」の表の ③
// どの関数が図のどこに当たるかの一覧は、文書の図の下の「図とコードの対応」の表
//   options（JSON）→ parseRequestOptionsFromJSON → navigator.credentials.get → credential.toJSON()（JSON）

const button = document.getElementById('passkey-login');
const message = document.getElementById('passkey-message');

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ログイン 1：「パスキーでログイン」を押す
button?.addEventListener('click', async () => {
  message.textContent = '';
  try {
    // ログイン 2 → ログイン 3：challenge 入りの options をもらう（ユーザー名は送らない）
    const options = await post('/login/passkey/options');
    // ログイン 4 → 5 → 6：認証器がこの RP ID の鍵を探して利用者に選ばせ、指紋・PIN のあとで署名する
    const credential = await navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
    });
    // ログイン 6 のあとの Note：ブラウザが clientDataJSON（種類・challenge・origin）を作って添えている
    // ログイン 7：鍵の ID、authenticatorData、署名、利用者の ID、clientDataJSON をまとめて送る
    const result = await post('/login/passkey/verify', { credential: credential.toJSON() });
    // ログイン 10：セッションの Cookie はもう付いている。アカウントの画面へ
    location.href = result.redirect;
  } catch (err) {
    message.textContent = err.name === 'NotAllowedError' ? '取り消されたか、時間切れになりました' : err.message;
  }
});
