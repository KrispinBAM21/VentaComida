const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") || "";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });
}

async function telegram(method: string, payload: unknown = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Falta TELEGRAM_BOT_TOKEN");
  }

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const data = await res.json();

  if (!res.ok || data?.ok === false) {
    throw new Error(`Telegram ${method}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function verifyAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "No autorizado" };
  }

  if (!SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: "Falta SUPABASE_ANON_KEY" };
  }

  const token = authHeader.slice("Bearer ".length).trim();

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!userRes.ok) {
    return { ok: false, status: 401, error: "Sesión inválida" };
  }

  const user = await userRes.json();

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_catalog_admin`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const rpcText = await rpcRes.text();

  if (!rpcRes.ok) {
    return {
      ok: false,
      status: 403,
      error: `No se pudo validar administrador: ${rpcText}`,
    };
  }

  let isAdmin = false;

  try {
    isAdmin = JSON.parse(rpcText) === true;
  } catch {
    isAdmin = rpcText.trim() === "true";
  }

  if (!isAdmin) {
    return { ok: false, status: 403, error: "Sin permisos" };
  }

  return { ok: true, user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    const auth = await verifyAdmin(req);

    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
      return json(
        {
          error:
            "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_ADMIN_CHAT_ID en secretos de Supabase.",
        },
        400
      );
    }

    if (action === "status") {
      const me = await telegram("getMe");
      const webhook = await telegram("getWebhookInfo");

      return json({
        ok: true,
        bot_username: me?.result?.username || null,
        bot_name: me?.result?.first_name || null,
        webhook_url: webhook?.result?.url || null,
        webhook_pending_updates:
          webhook?.result?.pending_update_count ?? 0,
        webhook_last_error:
          webhook?.result?.last_error_message || null,
      });
    }

    if (action === "test") {
      const result = await telegram("sendMessage", {
        chat_id: TELEGRAM_ADMIN_CHAT_ID,
        text:
          "VentaComida: conexión administrativa de Telegram correcta.",
      });

      return json({
        ok: true,
        message_id: result?.result?.message_id || null,
      });
    }

    if (action === "set_webhook") {
      if (!TELEGRAM_WEBHOOK_SECRET) {
        return json(
          {
            error:
              "Falta TELEGRAM_WEBHOOK_SECRET en secretos de Supabase.",
          },
          400
        );
      }

      const webhookUrl =
        `${SUPABASE_URL}/functions/v1/telegram-webhook`;

      const result = await telegram("setWebhook", {
        url: webhookUrl,
        secret_token: TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: [
          "callback_query",
          "message",
        ],
        drop_pending_updates: false,
      });

      return json({
        ok: true,
        webhook_url: webhookUrl,
        telegram: result,
      });
    }

    if (action === "delete_webhook") {
      const result = await telegram("deleteWebhook", {
        drop_pending_updates: false,
      });

      return json({
        ok: true,
        telegram: result,
      });
    }

    return json(
      {
        error: "Acción no válida",
      },
      400
    );
  } catch (error) {
    console.error(error);

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error interno",
      },
      500
    );
  }
});
