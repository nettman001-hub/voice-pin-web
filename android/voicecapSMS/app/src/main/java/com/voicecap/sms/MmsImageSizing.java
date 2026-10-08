package com.voicecap.sms;

/**
 * MMS 사진 줄이기 계산 (안드로이드 의존성 없음, JVM 테스트 대상). 실제 디코딩·JPEG 압축은 {@link MmsImages}가 한다.
 * 통신사 MMS 최대 크기(SmsManager carrier config)에서 헤더·SMIL·글 몫을 뺀 나머지를 사진 수로 나눠 한 장의 한도로 쓴다.
 */
public final class MmsImageSizing {
    /** carrier config를 못 읽었을 때 쓰는 MMS 최대 크기. */
    public static final int DEFAULT_MAX_MESSAGE_BYTES = 300 * 1024;
    /** 헤더·SMIL·파트 헤더 몫. */
    static final int OVERHEAD_BYTES = 4 * 1024;
    /** 한 번에 붙일 수 있는 사진 수 (서버 첨부 상한 8개보다 작게). */
    public static final int MAX_IMAGES = 5;
    /** 처음 시도하는 긴 변. 원본이 더 작으면 키우지 않는다. */
    static final int START_LONG_SIDE = 1600;
    /** 이보다 작게는 줄이지 않는다 (알아볼 수 없으므로 실패로 본다). */
    static final int MIN_LONG_SIDE = 240;
    /** 긴 변마다 차례로 시도하는 JPEG 품질. */
    static final int[] QUALITIES = {85, 75, 65, 55, 45};

    private MmsImageSizing() { }

    /** carrier config 값(MMS_CONFIG_MAX_MESSAGE_SIZE)이 없거나 0 이하이면 300KB. */
    public static int maxMessageBytes(int carrierValue) {
        return carrierValue > 0 ? carrierValue : DEFAULT_MAX_MESSAGE_BYTES;
    }

    /** 사진 한 장의 바이트 한도. 글이 너무 길어 사진 몫이 없으면 0. */
    public static int imageBudget(int maxMessageBytes, int textBytes, int imageCount) {
        if (imageCount <= 0) return 0;
        int remaining = maxMessageBytes - OVERHEAD_BYTES - Math.max(textBytes, 0);
        return remaining <= 0 ? 0 : remaining / imageCount;
    }

    /** 긴 변이 maxLongSide를 넘지 않게 비율을 지켜 줄인 {너비, 높이}. 키우지는 않는다. */
    public static int[] scaledSize(int width, int height, int maxLongSide) {
        int longSide = Math.max(width, height);
        if (longSide <= maxLongSide || longSide <= 0) return new int[]{width, height};
        double ratio = (double) maxLongSide / longSide;
        return new int[]{Math.max(1, (int) Math.round(width * ratio)), Math.max(1, (int) Math.round(height * ratio))};
    }

    /** 디코딩 때 쓸 inSampleSize: 줄인 뒤에도 긴 변이 targetLongSide 이상인 가장 큰 2의 거듭제곱. */
    public static int inSampleSize(int width, int height, int targetLongSide) {
        int longSide = Math.max(width, height);
        int sample = 1;
        while (targetLongSide > 0 && longSide / (sample * 2) >= targetLongSide) sample *= 2;
        return sample;
    }

    /** 첫 시도 긴 변. */
    public static int firstLongSide(int width, int height) {
        return Math.min(START_LONG_SIDE, Math.max(width, height));
    }

    /** 모든 품질로도 한도를 넘으면 긴 변을 3/4로 줄여 다시. 더 줄일 수 없으면 -1. */
    public static int nextLongSide(int currentLongSide) {
        if (currentLongSide <= MIN_LONG_SIDE) return -1;
        return Math.max(MIN_LONG_SIDE, currentLongSide * 3 / 4);
    }
}
