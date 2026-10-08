package com.voicecap.sms;

import com.voicecap.sms.pdu.CharacterSets;
import com.voicecap.sms.pdu.EncodedStringValue;
import com.voicecap.sms.pdu.InvalidHeaderValueException;
import com.voicecap.sms.pdu.PduBody;
import com.voicecap.sms.pdu.PduComposer;
import com.voicecap.sms.pdu.PduHeaders;
import com.voicecap.sms.pdu.PduPart;
import com.voicecap.sms.pdu.SendReq;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 보낼 MMS 한 통 (받는 사람 1명 + 글 + 줄인 JPEG 사진). 같은 파트 목록으로 m-send-req PDU(이식한 AOSP PduComposer)와
 * 보낸편지함 part 행({@link MmsStore#insertOutbox})을 만든다. 안드로이드 의존성이 없어 JVM 단위 테스트로 검증한다.
 * 파트 순서는 SMIL → 사진 → 글. 멀티파트 Content-Type의 start 파라미터가 첫 파트(SMIL)를 가리킨다.
 */
public final class MmsOutgoing {
    public static final String SMIL_TYPE = "application/smil";
    public static final String TEXT_TYPE = "text/plain";
    public static final String JPEG_TYPE = "image/jpeg";
    /** 보낸편지함 행의 content type (AOSP SendReq 기본값과 같다). */
    public static final String MESSAGE_CONTENT_TYPE = "application/vnd.wap.multipart.related";
    /** X-Mms-Expiry (상대값, 초). AOSP 메시지 앱 기본값과 같은 7일. */
    public static final long EXPIRY_SECONDS = 7L * 24 * 60 * 60;

    public static final class Part {
        public final String contentType;
        public final String contentId;
        public final String contentLocation;
        /** MIBenum. 0이면 지정하지 않음 (사진). */
        public final int charset;
        public final byte[] data;

        Part(String contentType, String contentId, String contentLocation, int charset, byte[] data) {
            this.contentType = contentType;
            this.contentId = contentId;
            this.contentLocation = contentLocation;
            this.charset = charset;
            this.data = data;
        }

        public boolean isText() { return TEXT_TYPE.equals(contentType) || SMIL_TYPE.equals(contentType); }
        public String text() { return new String(data, StandardCharsets.UTF_8); }
    }

    public final String to;
    public final String text;
    public final List<Part> parts;

    private MmsOutgoing(String to, String text, List<Part> parts) {
        this.to = to;
        this.text = text;
        this.parts = Collections.unmodifiableList(parts);
    }

    /**
     * @param to 받는 번호 (공백·괄호는 뺀다)
     * @param text 글. 비어 있으면 글 파트를 넣지 않는다.
     * @param jpegImages {@link MmsImageSizing}로 줄인 JPEG 바이트
     */
    public static MmsOutgoing create(String to, String text, List<byte[]> jpegImages) {
        String address = to == null ? "" : to.replaceAll("[\\s()]", "");
        if (address.isEmpty()) throw new IllegalArgumentException("받는 번호가 없습니다.");
        String body = text == null ? "" : text.trim();
        List<byte[]> images = jpegImages == null ? Collections.emptyList() : jpegImages;
        if (body.isEmpty() && images.isEmpty()) throw new IllegalArgumentException("보낼 내용이 없습니다.");
        List<Part> parts = new ArrayList<>();
        parts.add(new Part(SMIL_TYPE, "smil", "smil.xml", CharacterSets.UTF_8,
                smil(images.size(), !body.isEmpty()).getBytes(StandardCharsets.UTF_8)));
        for (int index = 0; index < images.size(); index++) {
            parts.add(new Part(JPEG_TYPE, "image" + index, "image" + index + ".jpg", 0, images.get(index)));
        }
        if (!body.isEmpty()) parts.add(new Part(TEXT_TYPE, "text0", "text0.txt", CharacterSets.UTF_8, body.getBytes(StandardCharsets.UTF_8)));
        return new MmsOutgoing(address, body, parts);
    }

    public int imageCount() {
        int count = 0;
        for (Part part : parts) if (!part.isText()) count++;
        return count;
    }

    /** 사진마다 한 장면, 글은 첫 장면에 함께 (사진이 없으면 글만 한 장면). */
    static String smil(int imageCount, boolean hasText) {
        StringBuilder smil = new StringBuilder("<smil><head><layout><root-layout width=\"320px\" height=\"480px\"/>");
        if (imageCount > 0) smil.append("<region id=\"Image\" left=\"0\" top=\"0\" width=\"320px\" height=\"320px\" fit=\"meet\"/>");
        if (hasText) smil.append("<region id=\"Text\" left=\"0\" top=\"").append(imageCount > 0 ? "320" : "0")
                .append("\" width=\"320px\" height=\"").append(imageCount > 0 ? "160px" : "480px").append("\" fit=\"meet\"/>");
        smil.append("</layout></head><body>");
        int slides = Math.max(imageCount, 1);
        for (int slide = 0; slide < slides; slide++) {
            smil.append("<par dur=\"5000ms\">");
            if (slide < imageCount) smil.append("<img src=\"image").append(slide).append(".jpg\" region=\"Image\"/>");
            if (slide == 0 && hasText) smil.append("<text src=\"text0.txt\" region=\"Text\"/>");
            smil.append("</par>");
        }
        return smil.append("</body></smil>").toString();
    }

    /** 보낼 때마다 새로 만든다. 여러 명에게 연달아 보내도 겹치지 않게 시각 + 난수. */
    public static String newTransactionId(long nowMillis, java.util.Random random) {
        return "T" + Long.toHexString(nowMillis) + Integer.toHexString(0x1000 + random.nextInt(0xF000));
    }

    /** m-send-req PDU. From은 insert-address-token(통신사가 채움), 배달·읽음 확인은 요청하지 않는다. */
    public byte[] toPdu(long dateSeconds, String transactionId) {
        SendReq request = new SendReq();
        try {
            request.addTo(new EncodedStringValue(to));
            request.setDate(dateSeconds);
            request.setExpiry(EXPIRY_SECONDS);
            request.setMessageClass(PduHeaders.MESSAGE_CLASS_PERSONAL_STR.getBytes(StandardCharsets.US_ASCII));
            request.setPriority(PduHeaders.PRIORITY_NORMAL);
            request.setDeliveryReport(PduHeaders.VALUE_NO);
            request.setReadReport(PduHeaders.VALUE_NO);
            request.setTransactionId(transactionId.getBytes(StandardCharsets.US_ASCII));
        } catch (InvalidHeaderValueException impossible) {
            throw new IllegalStateException(impossible);
        }
        PduBody body = new PduBody();
        for (Part part : parts) {
            PduPart pduPart = new PduPart();
            pduPart.setContentType(part.contentType.getBytes(StandardCharsets.US_ASCII));
            pduPart.setContentId(part.contentId.getBytes(StandardCharsets.US_ASCII));
            pduPart.setContentLocation(part.contentLocation.getBytes(StandardCharsets.US_ASCII));
            if (part.charset != 0) pduPart.setCharset(part.charset);
            pduPart.setData(part.data);
            body.addPart(pduPart);
        }
        request.setBody(body);
        byte[] pdu = new PduComposer(request).make();
        if (pdu == null) throw new IllegalStateException("MMS를 만들지 못했습니다.");
        return pdu;
    }
}
