package com.voicecap.deposit;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * 은행 프리셋. 설치 여부는 AndroidManifest의 &lt;queries&gt;에 적은 패키지만 확인할 수 있다 (QUERY_ALL_PACKAGES는 쓰지 않음).
 * 여기와 &lt;queries&gt;를 함께 고친다. 하나은행은 실기기에서 패키지명을 확인한 뒤 넣는다.
 */
public final class BankPresets {
    public static final class Preset {
        public final String packageName;
        public final String name;

        Preset(String packageName, String name) {
            this.packageName = packageName;
            this.name = name;
        }
    }

    public static final List<Preset> ALL = Collections.unmodifiableList(Arrays.asList(
            new Preset("com.kbstar.kbbank", "KB국민은행"),
            new Preset("com.shinhan.sbanking", "신한은행"),
            new Preset("com.wooribank.smart.npib", "우리은행"),
            new Preset("nh.smart.banking", "NH농협은행"),
            new Preset("com.kakaobank.channel", "카카오뱅크"),
            new Preset("viva.republica.toss", "토스"),
            new Preset("com.ibk.neobanking", "IBK기업은행"),
            new Preset("com.kbankwith.smartbank", "케이뱅크")));

    private BankPresets() { }

    public static Preset find(String packageName) {
        for (Preset preset : ALL) if (preset.packageName.equals(packageName)) return preset;
        return null;
    }
}
