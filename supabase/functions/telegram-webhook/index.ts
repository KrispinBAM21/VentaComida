const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") || "";
const TELEGRAM_ADMIN_USER_ID = Deno.env.get("TELEGRAM_ADMIN_USER_ID") || "";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";

function serviceHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sbRest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(),
      ...(init.headers || {}),
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Supabase REST ${res.status}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

async function telegram(method: string, payload: unknown) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN no configurado");
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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  try {
    if (
      TELEGRAM_WEBHOOK_SECRET &&
      req.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        TELEGRAM_WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }

    const update = await req.json();
    const callback = update?.callback_query;

    if (!callback) {
      return new Response("ok", { status: 200 });
    }

    const chatId = String(callback?.message?.chat?.id ?? "");
    const userId = String(callback?.from?.id ?? "");

    if (
      TELEGRAM_ADMIN_CHAT_ID &&
      chatId !== String(TELEGRAM_ADMIN_CHAT_ID)
    ) {
      return new Response("forbidden", { status: 403 });
    }

    if (
      TELEGRAM_ADMIN_USER_ID &&
      userId !== String(TELEGRAM_ADMIN_USER_ID)
    ) {
      return new Response("forbidden", { status: 403 });
    }

    const raw = String(callback?.data || "");
    const [action, orderId] = raw.split(":");

    if (
      !["approve", "reject", "view"].includes(action) ||
      !/^[0-9a-f-]{36}$/i.test(orderId || "")
    ) {
      return new Response("bad request", { status: 400 });
    }

    const orders = await sbRest(
      `orders?id=eq.${encodeURIComponent(orderId)}&select=id,public_id,customer_name,total,expected_amount,payment_status&limit=1`
    );

    const order = Array.isArray(orders) ? orders[0] : null;

    if (!order) {
      return new Response("not found", { status: 404 });
    }

    if (action === "view") {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: `${order.public_id} - $${Number(
          order.expected_amount ?? order.total
        ).toFixed(2)} MXN`,
        show_alert: true,
      });

      return new Response("ok", { status: 200 });
    }

    const nextStatus =
      action === "approve" ? "APPROVED" : "REJECTED";

    await sbRest(`orders?id=eq.${orderId}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        payment_status: nextStatus,
        approved_at:
          nextStatus === "APPROVED"
            ? new Date().toISOString()
            : null,
        rejected_at:
          nextStatus === "REJECTED"
            ? new Date().toISOString()
            : null,
        rejection_reason:
          nextStatus === "REJECTED"
            ? "Rechazado desde Telegram"
            : null,
      }),
    });

    await sbRest("order_events", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        order_id: orderId,
        event_type:
          nextStatus === "APPROVED"
            ? "PAYMENT_APPROVED"
            : "PAYMENT_REJECTED",
        old_status: order.payment_status,
        new_status: nextStatus,
        source: "TELEGRAM_ADMIN",
        metadata: {
          telegram_user_id: callback?.from?.id ?? null,
        },
      }),
    });

    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text:
        nextStatus === "APPROVED"
          ? "Pago aprobado"
          : "Pago rechazado",
    });

    if (
      callback?.message?.chat?.id &&
      callback?.message?.message_id
    ) {
      await telegram("editMessageReplyMarkup", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response(
      error instanceof Error ? error.message : "Error interno",
      { status: 500 }
    );
  }
});
