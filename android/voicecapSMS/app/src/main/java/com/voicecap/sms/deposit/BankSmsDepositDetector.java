package com.voicecap.sms.deposit;

import android.content.Context;
import android.util.Log;

import com.voicecap.sms.LocalDb;
import com.voicecap.sms.SyncScheduler;

import java.util.List;

/**
 * 은행 SMS 입금 문자 (설계 4.5, 선택 기능, 기본 꺼짐). 기본 문자앱이 받은 문자를 문자함에 저장한 뒤 호출된다.
 * 스위치가 켜져 있고(입금 정보 전송 동의 필수) 발신번호가 bank_rules.json smsRules의 senders에 있을 때만
 * 은행 알림과 같은 규칙 엔진으로 읽어 source=SMS로 payment-incoming 업로드한다. 문자 원문은 올리지 않는다.
 * 문자는 평소처럼 문자함·알림에 그대로 남는다.
 */
public final class BankSmsDepositDetector {
    private static final String TAG = "VoiceCAP";

    private BankSmsDepositDetector() { }

    /** 스위치와 동의가 모두 있어야 켜진 것으로 본다. */
    public static boolean enabled(boolean switchOn, boolean consent) {
        return switchOn && consent;
    }

    /**
     * 발신번호를 숫자만 남긴다. 1588-9999 → 15889999. +82로 시작하면 국내 형식으로 바꾼다:
     * 전국대표번호(1로 시작하는 8자리)는 그대로(+8215889999 → 15889999), 그 밖에는 0을 붙인다(+821012345678 → 01012345678).
     */
    public static String normalizeSender(String address) {
        if (address == null) return "";
        String trimmed = address.trim();
        String digits = trimmed.replaceAll("[^0-9]", "");
        if (trimmed.startsWith("+82") && digits.startsWith("82")) {
            String rest = digits.substring(2);
            digits = rest.length() == 8 && rest.startsWith("1") ? rest : "0" + rest;
        }
        return digits;
    }

    /**
     * 판정만 한다 (android API 없음, JVM 테스트 대상). 꺼져 있으면 규칙을 보지도 않고 null.
     * 켜져 있으면 파서 결과(발신번호가 규칙에 없으면 NO_RULE).
     */
    public static DepositParser.Result detect(boolean enabled, DepositParser parser, String sender, String body, long sentAt) {
        if (!enabled) return null;
        return parser.parseSms(sender, body, sentAt);
    }

    /**
     * SmsReceiver가 받은 문자(분할 문자는 합친 뒤)를 문자함에 저장한 다음 부른다. 꺼져 있으면 아무것도 하지 않는다.
     * @param sentAt 문자의 보낸 시각 (없으면 받은 시각). externalId와 입금 시각에 쓴다.
     */
    public static void onSmsReceived(Context context, String sender, String body, long sentAt) {
        try {
            DepositParser.Result result = detect(DepositSettings.bankSmsEnabled(context),
                    new DepositParser(DepositRecorder.rules(context)), sender, body, sentAt);
            if (result == null) return;
            if (!result.ok()) {
                if (result.failure == DepositParser.Failure.NO_RULE) return; // 은행 번호가 아님: 기록·전송 없음
                List<BankRules.Rule> rules = DepositRecorder.rules(context).forSender(normalizeSender(sender));
                String key = rules.isEmpty() ? BankRules.SMS_KEY_PREFIX : rules.get(0).packageName;
                DepositSettings.countFailure(context, key);
                if (DepositSettings.sampleMode(context)) {
                    long now = System.currentTimeMillis();
                    LocalDb db = LocalDb.get(context);
                    db.purgeSamplesBefore(now - DepositSettings.SAMPLE_RETENTION_MILLIS);
                    db.insertSample(key, body, SampleMasker.mask(body, null), now);
                }
                return;
            }
            if (DepositRecorder.record(context, result.deposit, DepositRecorder.SOURCE_SMS)) SyncScheduler.scheduleNow(context);
        } catch (RuntimeException error) {
            Log.w(TAG, "은행 입금 문자 처리 실패", error);
        }
    }
}
