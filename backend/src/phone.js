export function normalizePhone(input) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

export function defaultTelephony() {
  return {
    workspaceName: "",
    workspacePhone: "",
    provider: "browser",
    fromNumber: "",
    accountSid: "",
    apiKey: "",
    apiToken: "",
    publicBaseUrl: "",
    exotelReady: false,
    twilioReady: false,
    updatedAt: null,
  };
}
