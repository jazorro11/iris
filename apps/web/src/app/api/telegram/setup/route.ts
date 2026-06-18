import { NextResponse } from "next/server";

function publicOrigin(request: Request): string {
  const fromEnv = process.env.TELEGRAM_WEBHOOK_BASE_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const fwd = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwd) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${fwd}`;
  }
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });

  const webhookUrl = `${publicOrigin(request)}/api/telegram/webhook`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, ...(secret ? { secret_token: secret } : {}) }),
  });
  return NextResponse.json({ webhookUrl, telegram: await res.json() });
}
