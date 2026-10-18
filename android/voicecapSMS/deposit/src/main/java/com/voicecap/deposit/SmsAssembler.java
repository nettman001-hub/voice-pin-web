package com.voicecap.deposit;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 한 번의 SMS_RECEIVED로 들어온 분할 PDU를 발신 번호별로 이어 붙인다 (긴 문자 1건 = 1건). 문자 앱의 SmsAssembler와 같다. */
public final class SmsAssembler {
    public static final class Segment {
        final String address;
        final String body;
        final long sentAtMillis;

        public Segment(String address, String body, long sentAtMillis) {
            this.address = address == null ? "" : address;
            this.body = body == null ? "" : body;
            this.sentAtMillis = sentAtMillis;
        }
    }

    public static final class Message {
        public final String address;
        public final String body;
        public final long sentAtMillis;

        Message(String address, String body, long sentAtMillis) {
            this.address = address;
            this.body = body;
            this.sentAtMillis = sentAtMillis;
        }
    }

    private SmsAssembler() { }

    public static List<Message> assemble(List<Segment> segments) {
        Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        Map<String, Long> firstSent = new LinkedHashMap<>();
        for (Segment segment : segments) {
            StringBuilder body = bodies.get(segment.address);
            if (body == null) {
                bodies.put(segment.address, new StringBuilder(segment.body));
                firstSent.put(segment.address, segment.sentAtMillis);
            } else {
                body.append(segment.body);
                if (segment.sentAtMillis > 0 && segment.sentAtMillis < firstSent.get(segment.address)) {
                    firstSent.put(segment.address, segment.sentAtMillis);
                }
            }
        }
        List<Message> messages = new ArrayList<>();
        for (Map.Entry<String, StringBuilder> entry : bodies.entrySet()) {
            messages.add(new Message(entry.getKey(), entry.getValue().toString(), firstSent.get(entry.getKey())));
        }
        return messages;
    }
}
