package com.voicecap.sms;

import org.junit.Test;

import static org.junit.Assert.assertFalse;

public class Phase1FlagTest {
    /** 판매관리는 사용자 결정 전까지 꺼진 채로 배포한다 (꺼진 동안 판매 코드 미실행). */
    @Test
    public void salesTabShipsDisabled() {
        assertFalse(BuildConfig.SALES_TAB_ENABLED);
    }
}
