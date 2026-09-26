import { parseArgs } from "node:util";
import { autoloadNodeEnv } from "../../lib/node-env.js";
import { findRenamedOption } from "../../lib/renamed-arguments.js";
import { resolveSiteUrl } from "../../lib/site-url.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

async function callTelegram(token, method, body) {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.description ?? `Telegram ${method} failed`);
  }
  return payload.result;
}

function printUsage() {
  console.log("Usage: jant telegram register-webhooks [--url <url>]");
  console.log("");
  console.log(
    "Registers a webhook for every bot in TELEGRAM_BOT_TOKENS, pointing at",
  );
  console.log("<url>/api/telegram/webhook/<bot_id> with the shared");
  console.log("TELEGRAM_WEBHOOK_SECRET. Run once after configuring the pool.");
  console.log("");
  console.log("Options:");
  console.log("  --url  The site's public URL");
  console.log("");
  console.log(
    "If --url is omitted, uses SITE_ORIGIN + SITE_PATH_PREFIX from the environment.",
  );
  console.log("");
  console.log("Environment (also read from .env.node):");
  console.log(
    "  TELEGRAM_BOT_TOKENS      Comma-separated <bot_id>:<secret> tokens",
  );
  console.log(
    "  TELEGRAM_WEBHOOK_SECRET  Shared secret_token for the webhooks",
  );
}

export async function run(argv) {
  const renamed = findRenamedOption("telegram register-webhooks", argv, {
    "--base-url": "--url",
  });
  if (renamed) {
    console.error(`Error: ${renamed}`);
    process.exit(1);
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  autoloadNodeEnv();

  const siteUrl = resolveSiteUrl({ url: values.url });
  if (!siteUrl) {
    console.error(
      "Error: telegram register-webhooks requires --url or SITE_ORIGIN in the environment.",
    );
    process.exit(1);
  }

  const rawTokens = process.env.TELEGRAM_BOT_TOKENS ?? "";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!rawTokens.trim()) {
    console.error("TELEGRAM_BOT_TOKENS is not set.");
    process.exit(1);
  }
  if (!secret.trim()) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set.");
    process.exit(1);
  }

  const baseUrl = siteUrl.replace(/\/+$/, "");
  const tokens = rawTokens
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  let failures = 0;
  for (const token of tokens) {
    const botId = token.split(":")[0]?.trim() ?? "";
    if (!/^\d+$/.test(botId)) {
      console.error(`Skipping malformed token (no numeric bot id).`);
      failures += 1;
      continue;
    }
    const webhookUrl = `${baseUrl}/api/telegram/webhook/${botId}`;
    try {
      const identity = await callTelegram(token, "getMe");
      await callTelegram(token, "setWebhook", {
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
      });
      console.log(`@${identity.username} (${botId}) -> ${webhookUrl}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`Bot ${botId} failed: ${detail}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`${failures} bot(s) failed to register.`);
    process.exit(1);
  }
  console.log(`Registered ${tokens.length} webhook(s).`);
}
