"""Voice regression cases for Pipecat (language switch, backchannel, stuck turns)."""

from __future__ import annotations

import unittest

from language_utils import detect_reply_language, is_backchannel, speech_language


class PipecatVoiceScenarios(unittest.TestCase):
    def test_explicit_hindi_request(self):
        self.assertEqual(
            detect_reply_language("It will be better if you speak in Hindi.", "en"),
            "hi",
        )

    def test_registration_intent_stays_english(self):
        self.assertEqual(
            detect_reply_language("Yes. I would like to complete my registration.", "en"),
            "en",
        )

    def test_backchannel_presence_check(self):
        self.assertTrue(is_backchannel("Hello? Are you there?"))
        self.assertTrue(is_backchannel("Hello? Are you there? Yeah."))
        self.assertTrue(is_backchannel("Yeah."))
        self.assertFalse(is_backchannel("I would like to complete my registration."))
        self.assertFalse(is_backchannel("I listen it already. You said it."))

    def test_devanagari_forces_hindi_tts(self):
        self.assertEqual(detect_reply_language("मुझे हिंदी में समझाओ", "en"), "hi")

    def test_english_request_from_hindi(self):
        self.assertEqual(detect_reply_language("please speak in English", "hi"), "en")

    def test_telugu_request(self):
        self.assertEqual(detect_reply_language("please talk in telugu", "en"), "te")
        self.assertEqual(detect_reply_language("తెలుగు లో మాట్లాడు", "en"), "te")

    def test_speech_language_codes(self):
        self.assertEqual(speech_language("hi-IN"), "hi")
        self.assertEqual(speech_language("en-IN"), "en")
        self.assertEqual(speech_language("te-IN"), "te")

    def test_client_demo_conversation_language_path(self):
        """Replay of the Anika pipecat log: English → Hindi request → stay hi."""
        lang = "en"
        turns = [
            ("Yes.", "en"),
            ("I'm not getting what you're saying. You please explain me in detail?", "en"),
            ("It will be better if you speak in Hindi.", "hi"),
            ("Hello? Are you there?", "hi"),  # backchannel must not flip language
            ("Hello? Are you there? Yeah.", "hi"),
        ]
        for text, expected in turns:
            if not is_backchannel(text):
                lang = detect_reply_language(text, lang)
            self.assertEqual(lang, expected, text)


if __name__ == "__main__":
    unittest.main()
