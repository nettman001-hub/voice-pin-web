package com.voicecap.sms;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;

import java.util.ArrayList;
import java.util.List;

/**
 * 듀얼 SIM: 켜진 SIM이 2개 이상이면 보낼 SIM을 고르게 하고 마지막 선택을 기억한다.
 * 켜진 SIM 목록은 READ_PHONE_STATE(선택 권한)가 있어야 읽을 수 있다. 없으면 시스템 기본 SIM으로 보낸다.
 */
final class SimChooser {
    private static final String LAST_SUB_ID = "last_sms_sub_id";

    static final class Sim {
        final int subId;
        final String label;

        Sim(int subId, String label) {
            this.subId = subId;
            this.label = label;
        }
    }

    private SimChooser() { }

    static boolean hasPhoneStatePermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED;
    }

    /** SIM 칸이 2개 이상인 기기 (권한 없이 알 수 있음). 권한을 요청할 가치가 있는지 판단용. */
    @SuppressWarnings("deprecation")
    static boolean multiSimDevice(Context context) {
        TelephonyManager manager = context.getSystemService(TelephonyManager.class);
        return manager != null && manager.getPhoneCount() > 1;
    }

    /** 켜진 SIM 목록. 권한이 없거나 읽지 못하면 빈 목록. */
    @SuppressLint("MissingPermission") // 바로 위에서 READ_PHONE_STATE를 확인한다.
    static List<Sim> activeSims(Context context) {
        List<Sim> sims = new ArrayList<>();
        if (!hasPhoneStatePermission(context)) return sims;
        SubscriptionManager manager = context.getSystemService(SubscriptionManager.class);
        if (manager == null) return sims;
        try {
            List<SubscriptionInfo> infos = manager.getActiveSubscriptionInfoList();
            if (infos == null) return sims;
            for (SubscriptionInfo info : infos) {
                CharSequence name = info.getDisplayName();
                String label = "SIM " + (info.getSimSlotIndex() + 1) + (name == null || name.length() == 0 ? "" : " · " + name);
                sims.add(new Sim(info.getSubscriptionId(), label));
            }
        } catch (RuntimeException ignored) { }
        return sims;
    }

    /** 이번 발송에 쓸 SIM: 마지막 선택 → 시스템 기본 SMS SIM → 첫 SIM. 고를 수 없으면 -1(시스템에 맡김). */
    static int chosen(Context context, List<Sim> sims) {
        int[] ids = new int[sims.size()];
        for (int index = 0; index < sims.size(); index++) ids[index] = sims.get(index).subId;
        int remembered = BridgePreferences.get(context).getInt(LAST_SUB_ID, -1);
        return ConversationLogic.pickSubscription(ids, remembered, SmsManager.getDefaultSmsSubscriptionId());
    }

    static void remember(Context context, int subId) {
        BridgePreferences.get(context).edit().putInt(LAST_SUB_ID, subId).apply();
    }

    static String label(List<Sim> sims, int subId) {
        for (Sim sim : sims) if (sim.subId == subId) return sim.label;
        return "SIM";
    }
}
