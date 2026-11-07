import nodemailer from 'nodemailer';

// メールの送り先は共通基盤の mail VM（本番は deploy が .env に書く、手元は compose.override.yaml の Mailpit）。
// VCN の中なのでログインはしない。差出人は共通基盤の承認済みの差出人（noreply@）で、表示名でアプリを区別する
export const transport = nodemailer.createTransport({
	host: process.env.SMTP_HOST,
	port: Number(process.env.SMTP_PORT ?? 25),
	// VCN の中の名前でつなぐので、STARTTLS の証明書は名前（mail.alphajinsei.com）を指定して確かめる。手元の Mailpit は TLS を出さない
	tls: process.env.SMTP_TLS_NAME ? { servername: process.env.SMTP_TLS_NAME } : undefined,
});

export const from = { name: 'sample-oci-vm-docker', address: process.env.MAIL_FROM ?? 'noreply@alphajinsei.com' };
