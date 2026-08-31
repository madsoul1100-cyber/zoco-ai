export {
  detectPublicUrl,
  resolveTelephony,
  publicTelephony,
  placeExotelCall,
  placeExotelCall as placeCall,
  mapExotelStatus,
  mapExotelStatus as mapTwilioStatus,
  mapExotelStatus as mapCallStatus,
  inboundLineStatus,
  syncInboundWebhook,
  inboundWebhookUrl,
  exotelStreamUrl,
  sendWhatsApp,
  sendSms,
  sendVerifySms,
  checkVerifySms,
  whatsappFromNumber,
  hangupTwiml,
  gatherTwiml,
  recordListenTwiml,
  transferTwiml,
} from "./exotel.js";

export async function redirectTwilioCall() {
  return null;
}
