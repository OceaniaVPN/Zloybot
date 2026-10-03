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

    const message = update.message ?? update.channel_post;
    const media = {
      photo: message?.photo?.length ? message.photo[message.photo.length - 1] : null,
      document: message?.document ?? null,
      video: message?.video ?? null,
      animation: message?.animation ?? null,
      audio: message?.audio ?? null,
      voice: message?.voice ?? null,
      video_note: message?.video_note ?? null,
      paid_media: message?.paid_media ?? null,
      story: message?.story ?? null,
      checklist: message?.checklist ?? null,
    };
    const mediaType =
      Object.entries(media).find(([, value]) => Boolean(value))?.[0] ?? null;

    console.log("Telegram update diagnostic:", JSON.stringify({
      type: update.channel_post ? "channel_post" : update.message ? "message" : "other",
      topLevelKeys: Object.keys(update),
      messageKeys: message ? Object.keys(message) : [],
      hasMessage: Boolean(message),
      chatType: message?.chat?.type ?? null,
      messageId: message?.message_id ?? null,
      hasPhoto: Boolean(message?.photo?.length),
      photoCount: message?.photo?.length ?? 0,
      hasDocument: Boolean(message?.document),
      hasVideo: Boolean(message?.video),
      hasAnimation: Boolean(message?.animation),
      hasAudio: Boolean(message?.audio),
      hasVoice: Boolean(message?.voice),
      hasVideoNote: Boolean(message?.video_note),
      hasPaidMedia: Boolean(message?.paid_media),
      hasStory: Boolean(message?.story),
      hasChecklist: Boolean(message?.checklist),
      hasMediaGroup: Boolean(message?.media_group_id),
      mediaGroupId: message?.media_group_id ?? null,
      protectedContent: Boolean(message?.has_protected_content),
      mediaType,
      captionLength: typeof message?.caption === "string" ? message.caption.length : 0,
      hasCaption: typeof message?.caption === "string",
      hasText: typeof message?.text === "string"
    }));

    if (!message?.chat?.id) {
      console.log("Unsupported Telegram update:", JSON.stringify(update));
      return new Response("OK");
    }

    const chatId = message.chat.id;

    if (message.text === "/start") {
      await telegram(env.BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: "Отправь мне фотографию — я попробую вернуть её.",
      });
      return new Response("OK");
    }

    const photo = message.photo;

    if (!photo?.length) {
      console.log("Telegram update has no photo. Media type:", mediaType ?? "none");

      if (message.chat.type === "private") {
        const diagnostic =
          "Диагностика Telegram\\n" +
          "Тип update: " + (update.channel_post ? "channel_post" : update.message ? "message" : "other") + "\\n" +
          "Тип чата: " + (message.chat.type ?? "unknown") + "\\n" +
          "ID сообщения: " + (message.message_id ?? "нет") + "\\n" +
          "Тип медиа: " + (mediaType ?? "нет") + "\\n" +
          "Фото в webhook: нет\\n" +
          "Защищённый контент: " + (message.has_protected_content ? "да" : "нет") + "\\n" +
          "Поля message: " + Object.keys(message).join(", ");

        await telegram(env.BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: diagnostic,
        });
      }

      // Do not use copyMessage here: Telegram can reject copying otherwise
      // valid messages ("the message can't be copied"). If Telegram supplied
      // a file_id, send that media directly instead.
      const directMethods = {
        document: "sendDocument",
        video: "sendVideo",
        animation: "sendAnimation",
        audio: "sendAudio",
        voice: "sendVoice",
        video_note: "sendVideoNote",
      };

      const directMethod = directMethods[mediaType];
      const mediaValue = mediaType ? media[mediaType] : null;

      if (directMethod && mediaValue?.file_id) {
        await telegram(env.BOT_TOKEN, directMethod, {
          chat_id: chatId,
          [mediaType]: mediaValue.file_id,
        });
      }

      return new Response("OK");
    }

    const largest = photo[photo.length - 1];
    const results = [];

    // copyMessage is intentionally not used. It is not guaranteed to work
    // even when the incoming message itself is valid.
    results.push(await telegram(env.BOT_TOKEN, "sendPhoto", {
      chat_id: chatId,
      photo: largest.file_id,
      caption: "Фото: file_id.",
    }));

    const fileInfo = await telegramJson(env.BOT_TOKEN, "getFile", {
      file_id: largest.file_id,
    });

    if (fileInfo?.ok && fileInfo.result?.file_path) {
      try {
        const fileUrl = "https://api.telegram.org/file/bot" + env.BOT_TOKEN + "/" + fileInfo.result.file_path;
        const fileResponse = await fetch(fileUrl);

        if (fileResponse.ok) {
          const bytes = await fileResponse.arrayBuffer();
          const contentType =
            fileResponse.headers.get("content-type") || "application/octet-stream";

          const formPhoto = new FormData();
          formPhoto.append("chat_id", String(chatId));
          formPhoto.append("photo", new Blob([bytes], { type: contentType }), "photo.jpg");
          formPhoto.append("caption", "Фото: скачивание + загрузка.");
          results.push(await telegramForm(env.BOT_TOKEN, "sendPhoto", formPhoto));

          const formDocument = new FormData();
          formDocument.append("chat_id", String(chatId));
          formDocument.append("document", new Blob([bytes], { type: contentType }), "photo.jpg");
          formDocument.append("caption", "Фото: document.");
          results.push(await telegramForm(env.BOT_TOKEN, "sendDocument", formDocument));
        } else {
          console.error("Telegram file download failed:", fileResponse.status);
        }
      } catch (error) {
        console.error("Telegram file upload fallback failed:", error);
      }
    }

    const successful = results.filter((r) => r?.ok).length;
    if (successful === 0) {
      await telegram(env.BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text:
          "Telegram доставил событие, но не удалось отправить фото обратно. " +
          "Проверь, что в webhook действительно есть поле photo и file_id.",
      });
    }

    return new Response("OK");
  },
};

async function telegram(token, method, body) {
  try {
    const response = await fetch(
      TELEGRAM_API + "/bot" + token + "/" + method,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Telegram " + method + " failed:", error);
    }

    return response;
  } catch (error) {
    console.error("Telegram " + method + " request failed:", error);
    return null;
  }
}

async function telegramJson(token, method, body) {
  try {
    const response = await fetch(
      TELEGRAM_API + "/bot" + token + "/" + method,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      console.error("Telegram " + method + " failed:", JSON.stringify(data));
    }

    return data;
  } catch (error) {
    console.error("Telegram " + method + " request failed:", error);
    return null;
  }
}

async function telegramForm(token, method, form) {
  try {
    const response = await fetch(
      TELEGRAM_API + "/bot" + token + "/" + method,
      {
        method: "POST",
        body: form,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Telegram " + method + " failed:", error);
    }

    return response;
  } catch (error) {
    console.error("Telegram " + method + " request failed:", error);
    return null;
  }
}
