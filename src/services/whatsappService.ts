import { logCorePosEvent } from "../lib/operationalLogger";

export type WhatsAppMessage = {
  to: string;
  text: string;
  from?: string | null;
};

export type WhatsAppSendResult = {
  deliveryMode: "log" | "twilio";
  messageId: string | null;
};

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveWhatsAppDeliveryMode = (): "log" | "twilio" => {
  const mode = normalizeOptionalText(process.env.WHATSAPP_DELIVERY_MODE)?.toLowerCase();
  return mode === "twilio" ? "twilio" : "log";
};

const sendViaTwilio = async (
  message: WhatsAppMessage,
): Promise<WhatsAppSendResult> => {
  const accountSid = normalizeOptionalText(process.env.TWILIO_ACCOUNT_SID);
  const authToken = normalizeOptionalText(process.env.TWILIO_AUTH_TOKEN);
  const from =
    normalizeOptionalText(message.from) ??
    normalizeOptionalText(process.env.WHATSAPP_FROM);

  if (!accountSid || !authToken || !from) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and WHATSAPP_FROM are required when WHATSAPP_DELIVERY_MODE=twilio",
    );
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: message.to,
        From: from,
        Body: message.text,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        sid?: string;
        message?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      payload?.message
        ? `Twilio WhatsApp failed (${response.status}): ${payload.message}`
        : `Twilio WhatsApp failed (${response.status})`,
    );
  }

  return {
    deliveryMode: "twilio",
    messageId: payload?.sid ?? null,
  };
};

export const sendWhatsAppMessage = async (
  message: WhatsAppMessage,
): Promise<WhatsAppSendResult> => {
  const deliveryMode = resolveWhatsAppDeliveryMode();

  if (deliveryMode === "twilio") {
    return sendViaTwilio(message);
  }

  logCorePosEvent("whatsapp.delivery.logged", {
    deliveryMode,
    to: message.to,
    from:
      normalizeOptionalText(message.from) ??
      normalizeOptionalText(process.env.WHATSAPP_FROM) ??
      null,
    text: message.text,
  });

  return {
    deliveryMode,
    messageId: null,
  };
};
