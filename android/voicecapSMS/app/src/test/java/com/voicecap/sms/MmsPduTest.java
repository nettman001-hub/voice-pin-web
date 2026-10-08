package com.voicecap.sms;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.*;

public class MmsPduTest {
    private static final class Bytes {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        Bytes b(int... values) { for (int v : values) out.write(v); return this; }
        Bytes text(String value) { byte[] raw = value.getBytes(StandardCharsets.UTF_8); out.write(raw, 0, raw.length); out.write(0); return this; }
        Bytes raw(byte[] raw) { out.write(raw, 0, raw.length); return this; }
        byte[] get() { return out.toByteArray(); }
        int size() { return out.size(); }
    }

    private static byte[] fromValue(String address) {
        Bytes inner = new Bytes().b(0x80).text(address);
        return new Bytes().b(inner.size()).raw(inner.get()).get();
    }

    @Test
    public void parsesNotificationInd() {
        byte[] pdu = new Bytes()
                .b(0x8C, 0x82)
                .b(0x98).text("T123")
                .b(0x8D, 0x92)
                .b(0x89).raw(fromValue("+821012345678/TYPE=PLMN"))
                .b(0x8A, 0x80)                         // 메시지 클래스: 모르는 헤더로 건너뜀
                .b(0x8E, 0x02, 0x10, 0x00)             // 크기 4096
                .b(0x88, 0x05, 0x81, 0x03, 0x01, 0x51, 0x80) // 상대 만료 86400초
                .b(0x83).text("http://mmsc.example/m/abc")
                .get();
        MmsPdu.NotificationInd ind = MmsPdu.parseNotificationInd(pdu);
        assertNotNull(ind);
        assertEquals("T123", ind.transactionId);
        assertEquals("http://mmsc.example/m/abc", ind.contentLocation);
        assertEquals("+821012345678", ind.from);
        assertEquals(4096, ind.messageSize);
        assertEquals(86400, ind.expiry);
        assertTrue(ind.expiryRelative);
    }

    @Test
    public void rejectsNonNotificationAndTruncatedPdus() {
        assertNull(MmsPdu.parseNotificationInd(null));
        assertNull(MmsPdu.parseNotificationInd(new byte[]{(byte) 0x8C, (byte) 0x84}));
        assertNull(MmsPdu.parseNotificationInd(new byte[]{(byte) 0x8C, (byte) 0x82, (byte) 0x89, 0x1E}));
    }

    @Test
    public void parsesRetrieveConfWithEucKrTextAndImage() {
        byte[] korean = "안녕하세요 주문할게요".getBytes(Charset.forName("EUC-KR"));
        byte[] jpeg = new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0};

        Bytes textHeaders = new Bytes().b(0x03, 0x83, 0x81, 0xA6).b(0xC0).text("<text0>");
        Bytes imageHeaders = new Bytes().b(0x9E).b(0x8E).text("img.jpg");
        Bytes contentTypeValue = new Bytes().b(0xB3).b(0x89).text("application/smil");
        Bytes subject = new Bytes().b(0xEA).text("hello");

        byte[] pdu = new Bytes()
                .b(0x8C, 0x84)
                .b(0x98).text("T123")
                .b(0x8B).text("mid-1")
                .b(0x8D, 0x92)
                .b(0x89).raw(fromValue("01012345678/TYPE=PLMN"))
                .b(0x97).text("01099998888/TYPE=PLMN")
                .b(0x96).b(subject.size()).raw(subject.get())
                .b(0x85, 0x04, 0x66, 0x00, 0x00, 0x00)
                .b(0x84).b(contentTypeValue.size()).raw(contentTypeValue.get())
                .b(0x02)
                .b(textHeaders.size(), korean.length).raw(textHeaders.get()).raw(korean)
                .b(imageHeaders.size(), jpeg.length).raw(imageHeaders.get()).raw(jpeg)
                .get();

        MmsPdu.RetrieveConf conf = MmsPdu.parseRetrieveConf(pdu);
        assertNotNull(conf);
        assertEquals("T123", conf.transactionId);
        assertEquals("mid-1", conf.messageId);
        assertEquals("01012345678", conf.from);
        assertEquals(1, conf.to.size());
        assertEquals("01099998888", conf.to.get(0));
        assertEquals("hello", conf.subject);
        assertEquals(0x66000000L, conf.dateSeconds);
        assertEquals(0x12, conf.mmsVersion);
        assertEquals("application/vnd.wap.multipart.related", conf.contentType);
        assertEquals(2, conf.parts.size());

        MmsPdu.Part text = conf.parts.get(0);
        assertEquals("text/plain", text.contentType);
        assertEquals(38, text.charset);
        assertEquals("text0", text.contentId);
        assertEquals("안녕하세요 주문할게요", text.text());

        MmsPdu.Part image = conf.parts.get(1);
        assertEquals("image/jpeg", image.contentType);
        assertEquals("img.jpg", image.contentLocation);
        assertArrayEquals(jpeg, image.data);
        assertEquals("안녕하세요 주문할게요", conf.bodyText());
    }

    @Test
    public void parsesTextualContentTypeAndNameParameter() {
        // Content-general-form: value-length + 문자열 미디어 타입 + Name 파라미터
        byte[] ctBody = new Bytes().text("image/png").b(0x85).text("photo.png").get();
        Bytes header = new Bytes().b(ctBody.length).raw(ctBody);
        byte[] data = new byte[]{1, 2, 3};
        byte[] pdu = new Bytes()
                .b(0x8C, 0x84)
                .b(0x84, 0xA3)                         // multipart.mixed
                .b(0x01)
                .b(header.size(), data.length).raw(header.get()).raw(data)
                .get();
        MmsPdu.RetrieveConf conf = MmsPdu.parseRetrieveConf(pdu);
        assertNotNull(conf);
        assertEquals(1, conf.parts.size());
        assertEquals("image/png", conf.parts.get(0).contentType);
        assertEquals("photo.png", conf.parts.get(0).name);
        assertArrayEquals(data, conf.parts.get(0).data);
    }

    @Test
    public void buildsNotifyRespInd() {
        byte[] expected = new Bytes().b(0x8C, 0x83).b(0x98).text("T123").b(0x8D, 0x92).b(0x95, 0x81).get();
        assertArrayEquals(expected, MmsPdu.buildNotifyRespInd("T123"));
    }

    @Test
    public void stripsAddressType() {
        assertEquals("01012345678", MmsPdu.stripAddressType("01012345678/TYPE=PLMN"));
        assertEquals("", MmsPdu.stripAddressType(null));
    }

    private static byte[] retrieveConf(Integer retrieveStatus, String transactionId) {
        Bytes pdu = new Bytes().b(0x8C, 0x84).b(0x98).text(transactionId).b(0x8D, 0x92);
        if (retrieveStatus != null) pdu.b(0x99, retrieveStatus);
        byte[] text = "hi".getBytes(StandardCharsets.UTF_8);
        return pdu.b(0x84, 0x83).raw(text).get(); // 단일 text/plain 본문
    }

    @Test
    public void parsesRetrieveStatusAndClassifiesIt() {
        assertEquals(MmsPdu.RETRIEVE_STATUS_OK, MmsPdu.parseRetrieveConf(retrieveConf(null, "T1")).retrieveStatus);
        assertEquals(0x80, MmsPdu.parseRetrieveConf(retrieveConf(0x80, "T1")).retrieveStatus);
        assertEquals(0xC1, MmsPdu.parseRetrieveConf(retrieveConf(0xC1, "T1")).retrieveStatus);
        assertEquals(0xE2, MmsPdu.parseRetrieveConf(retrieveConf(0xE2, "T1")).retrieveStatus);

        assertEquals(MmsPdu.RetrieveOutcome.OK, MmsPdu.retrieveOutcome(0x80));
        assertEquals(MmsPdu.RetrieveOutcome.RETRY, MmsPdu.retrieveOutcome(0xC0));
        assertEquals(MmsPdu.RetrieveOutcome.RETRY, MmsPdu.retrieveOutcome(0xC3));
        assertEquals(MmsPdu.RetrieveOutcome.RETRY, MmsPdu.retrieveOutcome(0xDF));
        assertEquals(MmsPdu.RetrieveOutcome.DROP, MmsPdu.retrieveOutcome(0xE0));
        assertEquals(MmsPdu.RetrieveOutcome.DROP, MmsPdu.retrieveOutcome(0xE3));
        assertEquals(MmsPdu.RetrieveOutcome.DROP, MmsPdu.retrieveOutcome(0xFF));
        assertEquals(MmsPdu.RetrieveOutcome.DROP, MmsPdu.retrieveOutcome(0x81));
    }

    @Test
    public void alwaysUsesNotificationTransactionId() {
        MmsPdu.RetrieveConf conf = MmsPdu.parseRetrieveConf(retrieveConf(null, "retrieve-T9"));
        assertEquals("retrieve-T9", conf.transactionId);
        assertEquals("notice-T1", MmsPdu.resolveTransactionId("notice-T1", conf.transactionId));
        assertEquals("retrieve-T9", MmsPdu.resolveTransactionId(null, conf.transactionId));
        assertEquals("retrieve-T9", MmsPdu.resolveTransactionId("", conf.transactionId));
        assertEquals("", MmsPdu.resolveTransactionId(null, null));
        // 수신 확인 PDU에는 알림 쪽 transaction id가 들어간다.
        byte[] expected = new Bytes().b(0x8C, 0x83).b(0x98).text("notice-T1").b(0x8D, 0x92).b(0x95, 0x81).get();
        assertArrayEquals(expected, MmsPdu.buildNotifyRespInd(MmsPdu.resolveTransactionId("notice-T1", conf.transactionId)));
    }

    @Test
    public void stripsQuoteAndBracketsFromContentId() {
        Bytes headers = new Bytes().b(0x83).b(0xC0).b(0x22).text("<part1>");
        byte[] data = "x".getBytes(StandardCharsets.UTF_8);
        byte[] pdu = new Bytes()
                .b(0x8C, 0x84)
                .b(0x84, 0xA3)
                .b(0x01)
                .b(headers.size(), data.length).raw(headers.get()).raw(data)
                .get();
        MmsPdu.RetrieveConf conf = MmsPdu.parseRetrieveConf(pdu);
        assertNotNull(conf);
        assertEquals("part1", conf.parts.get(0).contentId);
    }

    @Test
    public void decodesKoreanCharsets() {
        // "똠"은 EUC-KR(KS X 1001)에 없고 CP949 확장 완성형에만 있다.
        String text = "똠양꿍 주문";
        byte[] cp949 = text.getBytes(Charset.forName("x-windows-949"));
        assertEquals(text, MmsPdu.decode(cp949, 36));
        assertEquals(text, MmsPdu.decode(cp949, 38));
        byte[] euckr = "안녕하세요".getBytes(Charset.forName("EUC-KR"));
        assertEquals("안녕하세요", MmsPdu.decode(euckr, 36));
    }

    @Test
    public void mapsCharsetNamesAndNumericText() {
        assertEquals(36, MmsPdu.mibForName("KS_C_5601-1987"));
        assertEquals(38, MmsPdu.mibForName("euc-kr"));
        assertEquals(38, MmsPdu.mibForName("CP949"));
        assertEquals(106, MmsPdu.mibForName("utf-8"));
        assertEquals(106, MmsPdu.mibForName("106"));
        assertEquals(36, MmsPdu.mibForName(" 36 "));
        assertEquals(106, MmsPdu.mibForName("unknown-charset"));
    }

    @Test
    public void readsTextualNumericCharsetParameter() {
        // Content-Type: text/plain; charset="36"(글자로 적힌 MIBenum) → KS_C_5601로 해석
        byte[] korean = "주문할게요".getBytes(Charset.forName("x-windows-949"));
        byte[] ctBody = new Bytes().b(0x83).text("charset").text("36").get();
        Bytes headers = new Bytes().b(ctBody.length).raw(ctBody);
        byte[] pdu = new Bytes()
                .b(0x8C, 0x84)
                .b(0x84, 0xA3)
                .b(0x01)
                .b(headers.size(), korean.length).raw(headers.get()).raw(korean)
                .get();
        MmsPdu.RetrieveConf conf = MmsPdu.parseRetrieveConf(pdu);
        assertNotNull(conf);
        assertEquals(36, conf.parts.get(0).charset);
        assertEquals("주문할게요", conf.bodyText());
    }

    @Test
    public void computesNotificationExpiry() {
        MmsPdu.NotificationInd relative = new MmsPdu.NotificationInd();
        relative.expiry = 86400;
        relative.expiryRelative = true;
        assertEquals(1_000L + 86_400_000L, relative.expiresAtMillis(1_000L));

        MmsPdu.NotificationInd absolute = new MmsPdu.NotificationInd();
        absolute.expiry = 1_700_000_000L;
        assertEquals(1_700_000_000_000L, absolute.expiresAtMillis(5L));

        MmsPdu.NotificationInd none = new MmsPdu.NotificationInd();
        assertEquals(5L + MmsPdu.DEFAULT_EXPIRY_MILLIS, none.expiresAtMillis(5L));
    }

    @Test
    public void keepsOnlyPlainTextAndSmilInline() {
        MmsPdu.Part part = new MmsPdu.Part();
        part.contentType = "text/plain";
        assertTrue(part.isInlineText());
        part.contentType = "application/smil";
        assertTrue(part.isInlineText());
        part.contentType = "text/x-vCard";
        assertFalse(part.isInlineText());
        part.contentType = "text/html";
        assertFalse(part.isInlineText());
        part.contentType = "image/jpeg";
        assertFalse(part.isInlineText());
    }
}
