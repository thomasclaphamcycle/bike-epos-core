import { logCorePosEvent } from "../lib/operationalLogger";

export type SmsMessage = {
  to: string;
  text: string;
  from?: string | null;
};

export type SmsSendResult = {
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

const resolveSmsDeliveryMode = (): "log" | "twilio" => {
  const mode = normalizeOptionalText(process.env.SMS_DELIVERY_MODE)?.toLowerCase();
  return mode === "twilio" ? "twilio" : "log";
};

const sendViaTwilio = async (message: SmsMessage): Promise<SmsSendResult> => {
  const accountSid = normalizeOptionalText(process.env.TWILIO_ACCOUNT_SID);
  const authToken = normalizeOptionalText(process.env.TWILIO_AUTH_TOKEN);
  const from = normalizeOptionalText(message.from) ?? normalizeOptionalText(process.env.SMS_FROM);

  if (!accountSid || !authToken || !from) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and SMS_FROM are required when SMS_DELIVERY_MODE=twilio",
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
        ? `Twilio SMS failed (${response.status}): ${payload.message}`
        : `Twilio SMS failed (${response.status})`,
    );
  }

  return {
    deliveryMode: "twilio",
    messageId: payload?.sid ?? null,
  };
};

export const sendSmsMessage = async (message: SmsMessage): Promise<SmsSendResult> => {
  const deliveryMode = resolveSmsDeliveryMode();

  if (deliveryMode === "twilio") {
    return sendViaTwilio(message);
  }

  logCorePosEvent("sms.delivery.logged", {
    deliveryMode,
    to: message.to,
    from: normalizeOptionalText(message.from) ?? normalizeOptionalText(process.env.SMS_FROM) ?? null,
    text: message.text,
  });

  return {
    deliveryMode,
    messageId: null,
  };
};
