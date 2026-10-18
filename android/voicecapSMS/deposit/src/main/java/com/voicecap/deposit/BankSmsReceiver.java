package com.voicecap.deposit;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "은행 입금 문자도 읽기"(기본 꺼짐)용. 이 앱은 기본 문자앱이 아니므로 SMS_RECEIVED(문자 수신 권한)로 받은 문자를 읽기만 한다.
 * 문자 저장·알림은 기본 문자앱이 그대로 한다. 꺼져 있으면 문자 내용을 보지 않고 바로 돌아간다.
 */
public final class BankSmsReceiver extends BroadcastReceiver {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        Context app = context.getApplicationContext();
        if (!DepositSettings.bankSmsEnabled(app)) return;
        SmsMessage[] pdus = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (pdus == null || pdus.length == 0) return;
        List<SmsAssembler.Segment> segments = new ArrayList<>();
        for (SmsMessage pdu : pdus) {
            if (pdu == null) continue;
            segments.add(new SmsAssembler.Segment(pdu.getDisplayOriginatingAddress(), pdu.getDisplayMessageBody(), pdu.getTimestampMillis()));
        }
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                long receivedAt = System.currentTimeMillis();
                for (SmsAssembler.Message message : SmsAssembler.assemble(segments)) {
                    BankSmsDepositDetector.onSmsReceived(app, message.address, message.body,
                            message.sentAtMillis > 0 ? message.sentAtMillis : receivedAt);
                }
            } finally {
                pending.finish();
            }
        });
    }
}
