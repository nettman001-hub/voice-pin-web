package com.voicecap.sms;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 기본 문자앱이 직접 처리해야 하는 MMS PDU(OMA-MMS-ENC / WAP-230-WSP)의 최소 파서·조립기.
 * Android 프레임워크에 공개 API가 없어 수신 알림(m-notification-ind), 수신 본문(m-retrieve-conf),
 * 수신 확인(m-notifyresp-ind)만 다룬다. 안드로이드 의존성이 없어 JVM 단위 테스트로 검증한다.
 */
public final class MmsPdu {
    public static final int TYPE_NOTIFICATION_IND = 0x82;
    public static final int TYPE_NOTIFYRESP_IND = 0x83;
    public static final int TYPE_RETRIEVE_CONF = 0x84;

    static final int H_BCC = 0x81, H_CC = 0x82, H_CONTENT_LOCATION = 0x83, H_CONTENT_TYPE = 0x84,
            H_DATE = 0x85, H_EXPIRY = 0x88, H_FROM = 0x89, H_MESSAGE_ID = 0x8B, H_MESSAGE_TYPE = 0x8C,
            H_MMS_VERSION = 0x8D, H_MESSAGE_SIZE = 0x8E, H_STATUS = 0x95, H_SUBJECT = 0x96, H_TO = 0x97,
            H_TRANSACTION_ID = 0x98;

    static final int STATUS_RETRIEVED = 0x81;
    static final int MMS_VERSION_1_2 = 0x92;

    private static final Map<Integer, String> WELL_KNOWN_TYPES = new HashMap<>();
    static {
        WELL_KNOWN_TYPES.put(0x00, "*/*");
        WELL_KNOWN_TYPES.put(0x01, "text/*");
        WELL_KNOWN_TYPES.put(0x02, "text/html");
        WELL_KNOWN_TYPES.put(0x03, "text/plain");
        WELL_KNOWN_TYPES.put(0x06, "text/x-vCalendar");
        WELL_KNOWN_TYPES.put(0x07, "text/x-vCard");
        WELL_KNOWN_TYPES.put(0x08, "text/vnd.wap.wml");
        WELL_KNOWN_TYPES.put(0x1C, "image/*");
        WELL_KNOWN_TYPES.put(0x1D, "image/gif");
        WELL_KNOWN_TYPES.put(0x1E, "image/jpeg");
        WELL_KNOWN_TYPES.put(0x1F, "image/tiff");
        WELL_KNOWN_TYPES.put(0x20, "image/png");
        WELL_KNOWN_TYPES.put(0x21, "image/vnd.wap.wbmp");
        WELL_KNOWN_TYPES.put(0x22, "application/vnd.wap.multipart.*");
        WELL_KNOWN_TYPES.put(0x23, "application/vnd.wap.multipart.mixed");
        WELL_KNOWN_TYPES.put(0x26, "application/vnd.wap.multipart.alternative");
        WELL_KNOWN_TYPES.put(0x27, "application/xml");
        WELL_KNOWN_TYPES.put(0x28, "text/xml");
        WELL_KNOWN_TYPES.put(0x33, "application/vnd.wap.multipart.related");
    }

    private static final Map<Integer, String> CHARSETS = new HashMap<>();
    static {
        CHARSETS.put(3, "US-ASCII");
        CHARSETS.put(4, "ISO-8859-1");
        CHARSETS.put(17, "Shift_JIS");
        CHARSETS.put(38, "EUC-KR");
        CHARSETS.put(106, "UTF-8");
        CHARSETS.put(1000, "UTF-16");
        CHARSETS.put(1015, "UTF-16");
        CHARSETS.put(2026, "Big5");
    }

    public static final class NotificationInd {
        public String transactionId = "";
        public String contentLocation = "";
        public String from = "";
        public String subject = "";
        public long messageSize;
        public long expiry;
    }

    public static final class Part {
        public String contentType = "application/octet-stream";
        public int charset = 106;
        public String name = "";
        public String contentId = "";
        public String contentLocation = "";
        public byte[] data = new byte[0];

        public boolean isText() { return contentType.startsWith("text/") || "application/smil".equals(contentType); }
        public String text() { return new String(data, charsetFor(charset)); }
    }

    public static final class RetrieveConf {
        public String transactionId = "";
        public String messageId = "";
        public String from = "";
        public final List<String> to = new ArrayList<>();
        public String subject = "";
        public long dateSeconds;
        public int mmsVersion = 0x12;
        public String contentType = "";
        public final List<Part> parts = new ArrayList<>();

        /** 본문 텍스트 파트를 이어 붙인 값 (SMIL 제외). */
        public String bodyText() {
            StringBuilder text = new StringBuilder();
            for (Part part : parts) {
                if (!part.contentType.startsWith("text/plain")) continue;
                if (text.length() > 0) text.append('\n');
                text.append(part.text());
            }
            return text.toString();
        }
    }

    private MmsPdu() { }

    public static Charset charsetFor(int mib) {
        String name = CHARSETS.get(mib);
        try {
            return name == null ? StandardCharsets.UTF_8 : Charset.forName(name);
        } catch (Exception ignored) {
            return StandardCharsets.UTF_8;
        }
    }

    /** m-notification-ind를 해석한다. 형식이 다르거나 필수 값이 없으면 null. */
    public static NotificationInd parseNotificationInd(byte[] pdu) {
        if (pdu == null) return null;
        try {
            Reader in = new Reader(pdu);
            NotificationInd ind = new NotificationInd();
            int type = -1;
            while (in.hasMore()) {
                int field = in.u8();
                switch (field) {
                    case H_MESSAGE_TYPE: type = in.u8(); break;
                    case H_TRANSACTION_ID: ind.transactionId = in.textString(); break;
                    case H_CONTENT_LOCATION: ind.contentLocation = in.textString(); break;
                    case H_FROM: ind.from = in.fromValue(); break;
                    case H_SUBJECT: ind.subject = in.encodedString(); break;
                    case H_MESSAGE_SIZE: ind.messageSize = in.longInteger(); break;
                    case H_EXPIRY: ind.expiry = in.expiryValue(); break;
                    default: in.skipValue(field); break;
                }
            }
            if (type != TYPE_NOTIFICATION_IND || ind.contentLocation.isEmpty() || ind.transactionId.isEmpty()) return null;
            return ind;
        } catch (RuntimeException malformed) {
            return null;
        }
    }

    /** 다운로드한 m-retrieve-conf를 해석한다. 형식이 다르면 null. */
    public static RetrieveConf parseRetrieveConf(byte[] pdu) {
        if (pdu == null) return null;
        try {
            Reader in = new Reader(pdu);
            RetrieveConf conf = new RetrieveConf();
            int type = -1;
            while (in.hasMore()) {
                int field = in.u8();
                if (field == H_CONTENT_TYPE) {
                    ContentType contentType = in.contentType();
                    conf.contentType = contentType.mediaType;
                    if (contentType.mediaType.startsWith("application/vnd.wap.multipart")) {
                        conf.parts.addAll(in.multipartBody());
                    } else {
                        Part single = new Part();
                        single.contentType = contentType.mediaType;
                        single.charset = contentType.charset;
                        single.data = in.rest();
                        conf.parts.add(single);
                    }
                    break; // Content-Type은 마지막 헤더이고 그 뒤는 본문이다.
                }
                switch (field) {
                    case H_MESSAGE_TYPE: type = in.u8(); break;
                    case H_TRANSACTION_ID: conf.transactionId = in.textString(); break;
                    case H_MESSAGE_ID: conf.messageId = in.textString(); break;
                    case H_FROM: conf.from = in.fromValue(); break;
                    case H_TO: conf.to.add(stripAddressType(in.encodedString())); break;
                    case H_SUBJECT: conf.subject = in.encodedString(); break;
                    case H_DATE: conf.dateSeconds = in.longInteger(); break;
                    case H_MMS_VERSION: conf.mmsVersion = in.u8() & 0x7F; break;
                    default: in.skipValue(field); break;
                }
            }
            if (type != TYPE_RETRIEVE_CONF) return null;
            return conf;
        } catch (RuntimeException malformed) {
            return null;
        }
    }

    /** MMSC에 "받았음"을 알리는 m-notifyresp-ind. 보내지 않으면 통신사가 같은 MMS 알림을 반복할 수 있다. */
    public static byte[] buildNotifyRespInd(String transactionId) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(H_MESSAGE_TYPE);
        out.write(TYPE_NOTIFYRESP_IND);
        out.write(H_TRANSACTION_ID);
        byte[] id = transactionId.getBytes(StandardCharsets.US_ASCII);
        if (id.length > 0 && (id[0] & 0xFF) >= 0x80) out.write(0x7F);
        out.write(id, 0, id.length);
        out.write(0x00);
        out.write(H_MMS_VERSION);
        out.write(MMS_VERSION_1_2);
        out.write(H_STATUS);
        out.write(STATUS_RETRIEVED);
        return out.toByteArray();
    }

    static String stripAddressType(String address) {
        if (address == null) return "";
        int slash = address.indexOf("/TYPE=");
        return (slash >= 0 ? address.substring(0, slash) : address).trim();
    }

    private static final class ContentType {
        String mediaType = "application/octet-stream";
        int charset = 106;
        String name = "";
    }

    private static final class Reader {
        private final byte[] data;
        private int pos;
        private int limit;

        Reader(byte[] data) { this.data = data; this.limit = data.length; }

        boolean hasMore() { return pos < limit; }
        int u8() {
            if (pos >= limit) throw new IllegalStateException("PDU ended early");
            return data[pos++] & 0xFF;
        }
        int peek() {
            if (pos >= limit) throw new IllegalStateException("PDU ended early");
            return data[pos] & 0xFF;
        }

        long uintvar() {
            long value = 0;
            for (int count = 0; count < 5; count++) {
                int b = u8();
                value = (value << 7) | (b & 0x7F);
                if ((b & 0x80) == 0) return value;
            }
            throw new IllegalStateException("uintvar too long");
        }

        byte[] bytes(int length) {
            if (length < 0 || pos + length > limit) throw new IllegalStateException("PDU ended early");
            byte[] result = new byte[length];
            System.arraycopy(data, pos, result, 0, length);
            pos += length;
            return result;
        }

        byte[] rest() { return bytes(limit - pos); }

        /** Value-length: 0~30은 그 자체가 길이, 31은 뒤따르는 uintvar가 길이. */
        int valueLength() {
            int b = u8();
            if (b <= 0x1E) return b;
            if (b == 0x1F) return (int) uintvar();
            throw new IllegalStateException("not a value-length");
        }

        String textString() {
            if (pos < limit && (data[pos] & 0xFF) == 0x7F) pos++;
            int start = pos;
            while (pos < limit && data[pos] != 0) pos++;
            String text = new String(data, start, pos - start, StandardCharsets.UTF_8);
            if (pos < limit) pos++;
            return text;
        }

        long longInteger() {
            int b = peek();
            if (b >= 0x80) return u8() & 0x7F;
            int length = u8();
            if (length > 8) throw new IllegalStateException("long-integer too long");
            long value = 0;
            for (int i = 0; i < length; i++) value = (value << 8) | u8();
            return value;
        }

        long integerValue() { return longInteger(); }

        /** Encoded-string-value: Text-string 또는 Value-length Char-set Text-string. */
        String encodedString() {
            int b = peek();
            if (b > 0x1F) return textString();
            int length = valueLength();
            int end = pos + length;
            int charset = (int) integerValue();
            if (pos < end && (data[pos] & 0xFF) == 0x7F) pos++;
            int textEnd = pos;
            while (textEnd < end && data[textEnd] != 0) textEnd++;
            String text = new String(data, pos, textEnd - pos, charsetFor(charset));
            pos = end;
            return text;
        }

        String fromValue() {
            int length = valueLength();
            int end = pos + length;
            int token = u8();
            String address = "";
            if (token == 0x80 && pos < end) {
                int saved = limit;
                limit = end;
                address = encodedString();
                limit = saved;
            }
            pos = end;
            return stripAddressType(address);
        }

        long expiryValue() {
            int length = valueLength();
            int end = pos + length;
            u8(); // absolute(0x80) / relative(0x81)
            long value = longInteger();
            pos = end;
            return value;
        }

        /** 모르는 헤더 값을 형식 규칙만으로 건너뛴다. */
        void skipValue(int field) {
            if ((field & 0x80) == 0) {
                // 응용 헤더: 이름(Text-string)을 이미 1바이트 읽었으므로 나머지 이름과 값을 건너뛴다.
                pos--;
                textString();
                textString();
                return;
            }
            int b = peek();
            if (b >= 0x80) { pos++; return; }
            if (b <= 0x1E) { pos += 1 + b; return; }
            if (b == 0x1F) { pos++; int length = (int) uintvar(); pos += length; return; }
            textString();
        }

        ContentType contentType() {
            ContentType type = new ContentType();
            int b = peek();
            if (b >= 0x80) {
                type.mediaType = wellKnown(u8() & 0x7F);
                return type;
            }
            if (b > 0x1F) {
                type.mediaType = textString().toLowerCase(java.util.Locale.ROOT);
                return type;
            }
            int length = valueLength();
            int end = pos + length;
            int first = peek();
            if (first >= 0x80) type.mediaType = wellKnown(u8() & 0x7F);
            else if (first <= 0x1E) type.mediaType = wellKnown((int) longInteger());
            else type.mediaType = textString().toLowerCase(java.util.Locale.ROOT);
            while (pos < end) {
                int key = u8();
                if ((key & 0x80) == 0) {
                    pos--;
                    String token = textString().toLowerCase(java.util.Locale.ROOT);
                    String value = paramValueAsText();
                    if ("charset".equals(token)) type.charset = mibForName(value);
                    else if ("name".equals(token) && type.name.isEmpty()) type.name = value;
                    continue;
                }
                int param = key & 0x7F;
                if (param == 0x01) { // Charset
                    int v = peek();
                    if (v > 0x1F && v < 0x80) type.charset = mibForName(textString());
                    else type.charset = (int) integerValue();
                } else if (param == 0x05 || param == 0x17 || param == 0x06 || param == 0x18) { // Name / Filename
                    String value = textString();
                    if (type.name.isEmpty() || param == 0x05 || param == 0x17) type.name = value;
                } else {
                    paramValueAsText();
                }
            }
            pos = end;
            return type;
        }

        String paramValueAsText() {
            int b = peek();
            if (b >= 0x80) return String.valueOf(u8() & 0x7F);
            if (b <= 0x1E) return String.valueOf(longInteger());
            if (b == 0x1F) { pos++; int length = (int) uintvar(); pos += length; return ""; }
            return textString();
        }

        List<Part> multipartBody() {
            long count = uintvar();
            if (count > 64) throw new IllegalStateException("too many parts");
            List<Part> parts = new ArrayList<>();
            for (long index = 0; index < count; index++) {
                int headersLength = (int) uintvar();
                int dataLength = (int) uintvar();
                int headersEnd = pos + headersLength;
                if (headersEnd > limit) throw new IllegalStateException("PDU ended early");
                int saved = limit;
                limit = headersEnd;
                Part part = new Part();
                ContentType contentType = contentType();
                part.contentType = contentType.mediaType;
                part.charset = contentType.charset;
                part.name = contentType.name;
                while (pos < headersEnd) {
                    int header = u8();
                    if (header == 0xC0) part.contentId = stripBrackets(textString());
                    else if (header == 0x8E) part.contentLocation = textString();
                    else skipValue(header);
                }
                limit = saved;
                pos = headersEnd;
                part.data = bytes(dataLength);
                parts.add(part);
            }
            return parts;
        }
    }

    static String wellKnown(int code) {
        String type = WELL_KNOWN_TYPES.get(code);
        return type == null ? "application/octet-stream" : type;
    }

    static int mibForName(String name) {
        if (name == null) return 106;
        String normalized = name.trim().toUpperCase(java.util.Locale.ROOT);
        for (Map.Entry<Integer, String> entry : CHARSETS.entrySet()) {
            if (entry.getValue().equalsIgnoreCase(normalized)) return entry.getKey();
        }
        if ("KS_C_5601-1987".equals(normalized) || "CP949".equals(normalized)) return 38;
        return 106;
    }

    private static String stripBrackets(String value) {
        if (value.startsWith("<") && value.endsWith(">") && value.length() >= 2) return value.substring(1, value.length() - 1);
        return value;
    }
}
