package com.voicecap.sms;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.*;

public class SmsPhase0LogicTest {
    @Test
    public void assemblesMultipartSmsPerSender() {
        List<SmsAssembler.Message> messages = SmsAssembler.assemble(Arrays.asList(
                new SmsAssembler.Segment("01012345678", "닉네임: 성훈맘 / 주소: 서울시 ", 2000L),
                new SmsAssembler.Segment("01012345678", "강남구 / 상품: 사과 2박스", 1000L),
                new SmsAssembler.Segment("01099998888", "다른 사람", 3000L)));
        assertEquals(2, messages.size());
        assertEquals("01012345678", messages.get(0).address);
        assertEquals("닉네임: 성훈맘 / 주소: 서울시 강남구 / 상품: 사과 2박스", messages.get(0).body);
        assertEquals(1000L, messages.get(0).sentAtMillis);
        assertEquals("다른 사람", messages.get(1).body);
    }

    @Test
    public void assemblesSingleSegmentAndNulls() {
        List<SmsAssembler.Message> messages = SmsAssembler.assemble(Arrays.asList(new SmsAssembler.Segment(null, null, 0L)));
        assertEquals(1, messages.size());
        assertEquals("", messages.get(0).address);
        assertEquals("", messages.get(0).body);
    }

    @Test
    public void uploadsOnlyPurchaseInfoOrBusinessNumbers() {
        String purchase = "닉네임: 성훈맘\n주소: 서울시 강남구\n상품: 사과 2박스";
        assertTrue(UploadFilter.shouldUpload(purchase, false, false));
        assertTrue(UploadFilter.shouldUpload("내일 받을 수 있나요?", true, false));
        assertFalse(UploadFilter.shouldUpload("[인증번호] 123456", false, false));
        assertFalse(UploadFilter.shouldUpload("엄마 저녁 뭐 먹어?", false, false));
        assertFalse(UploadFilter.shouldUpload(null, false, false));
    }

    @Test
    public void neverUploadsBlockedNumbers() {
        String purchase = "닉네임: 성훈맘\n주소: 서울시 강남구\n상품: 사과 2박스";
        assertFalse(UploadFilter.shouldUpload(purchase, true, true));
    }

    @Test
    public void uploadsAll010NumbersExceptBlocked() {
        assertTrue(UploadFilter.is010Number("010-1234-5678"));
        assertTrue(UploadFilter.is010Number("01012345678"));
        assertTrue(UploadFilter.is010Number("+82 10-9876-5432"));
        assertTrue(UploadFilter.is010Number("+821098765432"));
        assertFalse(UploadFilter.is010Number("02-123-4567"));
        assertFalse(UploadFilter.is010Number("1588-1234"));
        assertFalse(UploadFilter.is010Number("070-1234-5678"));

        assertTrue(UploadFilter.shouldUpload("010-1234-5678", "안녕하세요", false, false));
        assertTrue(UploadFilter.shouldUpload("+821012345678", "입금했습니다", false, false));
        assertFalse(UploadFilter.shouldUpload("010-1234-5678", "스팸", false, true));
    }

    @Test
    public void normalizesKoreanPhoneNumbers() {
        assertEquals("01012345678", BusinessContactStore.normalize("+82 10-1234-5678"));
        assertEquals("01012345678", BusinessContactStore.normalize("821012345678"));
        assertEquals("01012345678", BusinessContactStore.normalize("010-1234-5678"));
        assertEquals("", BusinessContactStore.normalize(null));
    }

    @Test
    public void backoffGrowsToFifteenMinuteCap() {
        assertEquals(60_000L, SyncBackoff.delayMillis(0));
        assertEquals(60_000L, SyncBackoff.delayMillis(1));
        assertEquals(120_000L, SyncBackoff.delayMillis(2));
        assertEquals(300_000L, SyncBackoff.delayMillis(3));
        assertEquals(900_000L, SyncBackoff.delayMillis(4));
        assertEquals(900_000L, SyncBackoff.delayMillis(50));
    }
}
