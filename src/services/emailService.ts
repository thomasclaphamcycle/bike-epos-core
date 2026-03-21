import nodemailer from "nodemailer";
import { logCorePosEvent } from "../lib/operationalLogger";

type EmailAddress = {
  email: string;
  name?: string;
};

export type EmailMessage = {
  to: string;
  from: EmailAddress;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  deliveryMode: "log" | "smtp";
  messageId: string | null;
};

let cachedTransport:
  | nodemailer.Transporter<nodemailer.SentMessageInfo>
  | null = null;
let cachedMode: "log" | "smtp" | null = null;

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveEmailDeliveryMode = (): "log" | "smtp" => {
  const mode = normalizeOptionalText(process.env.EMAIL_DELIVERY_MODE)?.toLowerCase();
  return mode === "smtp" ? "smtp" : "log";
};

const formatEmailAddress = (address: EmailAddress) => {
  const name = normalizeOptionalText(address.name);
  return name ? `${name} <${address.email}>` : address.email;
};

const resolveTransport = () => {
  const mode = resolveEmailDeliveryMode();
  if (cachedTransport && cachedMode === mode) {
    return {
      deliveryMode: mode,
      transport: cachedTransport,
    };
  }

  if (mode === "smtp") {
    const smtpUrl = normalizeOptionalText(process.env.SMTP_URL);
    if (!smtpUrl) {
      throw new Error("SMTP_URL is required when EMAIL_DELIVERY_MODE=smtp");
    }

    cachedTransport = nodemailer.createTransport(smtpUrl);
    cachedMode = mode;
    return {
      deliveryMode: mode,
      transport: cachedTransport,
    };
  }

  cachedTransport = nodemailer.createTransport({
    jsonTransport: true,
  });
  cachedMode = mode;
  return {
    deliveryMode: mode,
    transport: cachedTransport,
  };
};

export const sendEmailMessage = async (message: EmailMessage): Promise<EmailSendResult> => {
  const { deliveryMode, transport } = resolveTransport();
  const result = await transport.sendMail({
    from: formatEmailAddress(message.from),
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });

  if (deliveryMode === "log") {
    logCorePosEvent("email.delivery.logged", {
      deliveryMode,
      to: message.to,
      from: formatEmailAddress(message.from),
      subject: message.subject,
      messageId: result.messageId ?? null,
    });
  }

  return {
    deliveryMode,
    messageId: result.messageId ?? null,
  };
};
