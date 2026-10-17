package com.voicecap.sms;

import org.junit.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;

public class ConversationSnippetTest {
    private static String storedBytes(String text, Charset charset) {
        return new String(text.getBytes(charset), StandardCharsets.ISO_8859_1);
    }

    @Test
    public void restoresUtf8KoreanPreviewAndEmoji() {
        String title = "러블리님 주문 내역 💕 12,000원";
        assertEquals(title, ConversationLogic.decodeSnippet(storedBytes(title, StandardCharsets.UTF_8), 106));
    }

    @Test
    public void restoresKoreanLegacyCharsetsIncludingExtendedSyllables() {
        String title = "똠양꿍 주문 · 입금 확인";
        String raw = storedBytes(title, Charset.forName("x-windows-949"));
        assertEquals(title, ConversationLogic.decodeSnippet(raw, 36));
        assertEquals(title, ConversationLogic.decodeSnippet(raw, 38));
        String euckrTitle = "배송지 확인";
        assertEquals(euckrTitle, ConversationLogic.decodeSnippet(storedBytes(euckrTitle, Charset.forName("EUC-KR")), 38));
    }

    @Test
    public void preservesAlreadyDecodedTextAndMixedUnicode() {
        String title = "러블리💕 café 漢字 12,000원";
        assertEquals(title, ConversationLogic.decodeSnippet(title, 106));
        String mixed = "주문 " + storedBytes("확인", StandardCharsets.UTF_8);
        assertEquals(mixed, ConversationLogic.decodeSnippet(mixed, 106));
        assertEquals("café", ConversationLogic.decodeSnippet("café", 106));
        assertEquals("café", ConversationLogic.decodeSnippet("café", 4));
    }

    @Test
    public void preservesSmsWithoutEncodedCharsetAndAscii() {
        String sms = "배송 확인 💕";
        assertEquals(sms, ConversationLogic.decodeSnippet(sms, 0));
        String latinSms = "cafÃ©";
        assertEquals(latinSms, ConversationLogic.decodeSnippet(latinSms, 0));
        assertEquals("ORDER 123", ConversationLogic.decodeSnippet("ORDER 123", 106));
        assertEquals("", ConversationLogic.decodeSnippet(null, 106));
        assertEquals("", ConversationLogic.decodeSnippet("", 38));
    }

    @Test
    public void preservesTruncatedAndInvalidByteSequences() {
        String truncated = new String(new byte[]{(byte) 0xEC, (byte) 0xA3}, StandardCharsets.ISO_8859_1);
        assertEquals(truncated, ConversationLogic.decodeSnippet(truncated, 106));
        String invalidKorean = new String(new byte[]{(byte) 0x81}, StandardCharsets.ISO_8859_1);
        assertEquals(invalidKorean, ConversationLogic.decodeSnippet(invalidKorean, 38));
    }
}
