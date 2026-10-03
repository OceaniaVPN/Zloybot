const TELEGRAM_API = "https://api.telegram.org";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Zloybot is running", { status: 200 });
    }

    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") {
      return new Response("Not Found", { status: 404 });
    }

    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN is not configured", { status: 500 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // /start
    if (update.message?.text === "/start") {
      await telegram(env.BOT_TOKEN, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "Отправь мне фотографию — я верну её обратно.",
      });
      return new Response("OK");
    }

    // Photo message: reuse Telegram's file_id, so no temporary storage is needed.
    const photo = update.message?.photo;
    if (photo?.length) {
      const largest = photo[photo.length - 1];

      await telegram(env.BOT_TOKEN, "sendPhoto", {
        chat_id: update.message.chat.id,
        photo: largest.file_id,
        caption: "Готово.",
      });

      return new Response("OK");
    }

    return new Response("OK");
  },
};

async function telegram(token, method, body) {
  const response = await fetch(
    `${TELEGRAM_API}/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`Telegram ${method} failed:`, error);
  }

  return response;
}
