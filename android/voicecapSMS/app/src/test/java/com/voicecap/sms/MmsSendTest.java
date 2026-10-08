package com.voicecap.sms;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

import static org.junit.Assert.*;

/** Phase 6 MMS 보내기: 이식한 PduComposer로 만든 m-send-req를 수신용 파서로 다시 읽어 확인하고, 사진 줄이기 계산을 검사한다. */
public class MmsSendTest {
    private static byte[] fakeJpeg(int size, int seed) {
        byte[] data = new byte[size];
        new Random(seed).nextBytes(data);
        data[0] = (byte) 0xFF;
        data[1] = (byte) 0xD8;
        return data;
    }

    @Test
    public void sendReqRoundTripsThroughParser() {
        byte[] image = fakeJpeg(2048, 1);
        MmsOutgoing message = MmsOutgoing.create("010-1234-5678", "사진 보내드려요 😀", Collections.singletonList(image));
        byte[] pdu = message.toPdu(1791440580L, "T18a0001");

        assertEquals(0x8C, pdu[0] & 0xFF);
        assertEquals(MmsPdu.TYPE_SEND_REQ, pdu[1] & 0xFF);
        assertEquals(0x98, pdu[2] & 0xFF); // 바로 다음은 X-Mms-Transaction-ID (OMA 순서)

        MmsPdu.RetrieveConf parsed = MmsPdu.parseSendReq(pdu);
        assertNotNull(parsed);
        assertEquals("T18a0001", parsed.transactionId);
        assertEquals(0x12, parsed.mmsVersion);
        assertEquals(1791440580L, parsed.dateSeconds);
        assertEquals("", parsed.from); // insert-address-token: 통신사가 채움
        assertEquals(Collections.singletonList("010-1234-5678"), parsed.to);
        assertEquals("application/vnd.wap.multipart.related", parsed.contentType);

        assertEquals(3, parsed.parts.size());
        MmsPdu.Part smil = parsed.parts.get(0);
        assertEquals("application/smil", smil.contentType);
        assertEquals("smil", smil.contentId);
        assertTrue(smil.text().contains("image0.jpg"));
        assertTrue(smil.text().contains("text0.txt"));

        MmsPdu.Part jpeg = parsed.parts.get(1);
        assertEquals("image/jpeg", jpeg.contentType);
        assertEquals("image0", jpeg.contentId);
        assertEquals("image0.jpg", jpeg.contentLocation);
        assertEquals("image0.jpg", jpeg.name);
        assertArrayEquals(image, jpeg.data);

        MmsPdu.Part text = parsed.parts.get(2);
        assertEquals("text/plain", text.contentType);
        assertEquals(106, text.charset);
        assertEquals("text0", text.contentId);
        assertEquals("사진 보내드려요 😀", text.text());
        assertEquals("사진 보내드려요 😀", parsed.bodyText());
    }

    @Test
    public void addressGetsPlmnTypeOnTheWire() {
        byte[] pdu = MmsOutgoing.create("01012345678", "안녕", Collections.emptyList()).toPdu(1, "T1");
        String raw = new String(pdu, StandardCharsets.ISO_8859_1);
        assertTrue(raw.contains("01012345678/TYPE=PLMN"));
        assertTrue(indexOf(pdu, new byte[]{(byte) 0x89, 0x01, (byte) 0x81}) >= 0); // From: insert-address-token
    }

    @Test
    public void multipleImagesAndImageOnly() {
        List<byte[]> images = Arrays.asList(fakeJpeg(500, 2), fakeJpeg(700, 3), fakeJpeg(900, 4));
        MmsOutgoing message = MmsOutgoing.create(" (010) 9999 0000 ", "", images);
        assertEquals("01099990000", message.to);
        assertEquals(3, message.imageCount());
        MmsPdu.RetrieveConf parsed = MmsPdu.parseSendReq(message.toPdu(10, "T2"));
        assertNotNull(parsed);
        assertEquals(4, parsed.parts.size()); // SMIL + 사진 3장, 글 파트 없음
        for (int index = 0; index < 3; index++) {
            assertEquals("image" + index, parsed.parts.get(index + 1).contentId);
            assertArrayEquals(images.get(index), parsed.parts.get(index + 1).data);
        }
        assertEquals("", parsed.bodyText());
        String smil = parsed.parts.get(0).text();
        assertTrue(smil.contains("image2.jpg"));
        assertFalse(smil.contains("text0.txt"));
    }

    @Test
    public void textOnlyMmsHasSmilAndText() {
        MmsPdu.RetrieveConf parsed = MmsPdu.parseSendReq(MmsOutgoing.create("01011112222", "글만", null).toPdu(10, "T3"));
        assertNotNull(parsed);
        assertEquals(2, parsed.parts.size());
        assertEquals("글만", parsed.bodyText());
    }

    @Test(expected = IllegalArgumentException.class)
    public void emptyMessageIsRejected() {
        MmsOutgoing.create("01011112222", "   ", Collections.emptyList());
    }

    @Test(expected = IllegalArgumentException.class)
    public void missingRecipientIsRejected() {
        MmsOutgoing.create(" ", "안녕", Collections.emptyList());
    }

    @Test
    public void transactionIdsDoNotCollide() {
        Random random = new Random(7);
        Set<String> ids = new HashSet<>();
        for (int index = 0; index < 50; index++) ids.add(MmsOutgoing.newTransactionId(1791440580000L, random));
        assertTrue(ids.size() > 45);
        for (String id : ids) assertTrue(id.startsWith("T") && id.matches("T[0-9a-f]+"));
    }

    @Test
    public void parsesSendConf() {
        byte[] ok = bytes(0x8C, 0x81, 0x98, 'T', '1', 0, 0x8D, 0x92, 0x92, 0x80, 0x8B, 'm', 'i', 'd', '9', 0);
        MmsPdu.SendConf conf = MmsPdu.parseSendConf(ok);
        assertNotNull(conf);
        assertTrue(conf.ok());
        assertEquals("mid9", conf.messageId);
        assertEquals("T1", conf.transactionId);

        MmsPdu.SendConf rejected = MmsPdu.parseSendConf(bytes(0x8C, 0x81, 0x98, 'T', '1', 0, 0x92, 0xE2));
        assertNotNull(rejected);
        assertFalse(rejected.ok());

        assertNull(MmsPdu.parseSendConf(bytes(0x8C, 0x84, 0x98, 'T', '1', 0)));
        assertNull(MmsPdu.parseSendConf(null));
        assertNull(MmsPdu.parseSendReq(ok));
    }

    @Test
    public void carrierLimitFallsBackTo300KB() {
        assertEquals(300 * 1024, MmsImageSizing.maxMessageBytes(0));
        assertEquals(300 * 1024, MmsImageSizing.maxMessageBytes(-1));
        assertEquals(1048576, MmsImageSizing.maxMessageBytes(1048576));
    }

    @Test
    public void imageBudgetSplitsWhatIsLeft() {
        int max = 300 * 1024;
        assertEquals(max - MmsImageSizing.OVERHEAD_BYTES, MmsImageSizing.imageBudget(max, 0, 1));
        assertEquals((max - MmsImageSizing.OVERHEAD_BYTES - 1000) / 3, MmsImageSizing.imageBudget(max, 1000, 3));
        assertEquals(0, MmsImageSizing.imageBudget(max, max, 1));
        assertEquals(0, MmsImageSizing.imageBudget(max, 0, 0));
    }

    @Test
    public void composedMessageFitsCarrierLimitWhenImagesFitBudget() {
        int max = MmsImageSizing.DEFAULT_MAX_MESSAGE_BYTES;
        StringBuilder longText = new StringBuilder();
        for (int index = 0; index < 60; index++) longText.append("긴 안내 문구 ");
        String text = longText.toString();
        int textBytes = text.trim().getBytes(StandardCharsets.UTF_8).length;
        int count = MmsImageSizing.MAX_IMAGES;
        int budget = MmsImageSizing.imageBudget(max, textBytes, count);
        List<byte[]> images = new ArrayList<>();
        for (int index = 0; index < count; index++) images.add(fakeJpeg(budget, index));
        byte[] pdu = MmsOutgoing.create("01012345678", text, images).toPdu(1791440580L, "T18a0001ffff");
        assertTrue("PDU " + pdu.length + " > " + max, pdu.length <= max);
    }

    @Test
    public void scalingKeepsAspectAndNeverUpscales() {
        assertArrayEquals(new int[]{1600, 1200}, MmsImageSizing.scaledSize(4000, 3000, 1600));
        assertArrayEquals(new int[]{900, 1600}, MmsImageSizing.scaledSize(2250, 4000, 1600));
        assertArrayEquals(new int[]{800, 600}, MmsImageSizing.scaledSize(800, 600, 1600));
        assertEquals(1600, MmsImageSizing.firstLongSide(4000, 3000));
        assertEquals(800, MmsImageSizing.firstLongSide(800, 600));
    }

    @Test
    public void sampleSizeKeepsAtLeastTarget() {
        assertEquals(2, MmsImageSizing.inSampleSize(4000, 3000, 1600));
        assertEquals(4, MmsImageSizing.inSampleSize(6400, 4800, 1600));
        assertEquals(1, MmsImageSizing.inSampleSize(1000, 800, 1600));
        assertEquals(1, MmsImageSizing.inSampleSize(3000, 2000, 1600));
    }

    @Test
    public void longSideShrinksUntilMinimum() {
        int side = 1600;
        int steps = 0;
        while (side > 0) {
            int next = MmsImageSizing.nextLongSide(side);
            if (next > 0) assertTrue(next < side && next >= MmsImageSizing.MIN_LONG_SIDE);
            side = next;
            assertTrue(++steps < 20);
        }
        assertEquals(-1, MmsImageSizing.nextLongSide(MmsImageSizing.MIN_LONG_SIDE));
    }

    @Test
    public void sentMmsExternalIdIsSeparateFromSms() {
        assertEquals("device-mms-sent-42", ConversationLogic.mmsSentExternalId("42"));
        assertNotEquals(ConversationLogic.sentExternalId("42"), ConversationLogic.mmsSentExternalId("42"));
    }

    private static byte[] bytes(int... values) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int value : values) out.write(value);
        return out.toByteArray();
    }

    private static int indexOf(byte[] data, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= data.length; i++) {
            for (int j = 0; j < needle.length; j++) if (data[i + j] != needle[j]) continue outer;
            return i;
        }
        return -1;
    }
}
