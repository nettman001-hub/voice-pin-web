/*
 * Copyright (C) 2007-2008 Esmertec AG.
 * Copyright (C) 2007-2008 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Ported to VoiceCAP from AOSP frameworks/opt/mms (tag android-sdk-4.4.2_r1),
 * package com.google.android.mms.pdu. Modified: trimmed to what composing an
 * m-send-req needs, android.* dependencies removed so it runs in JVM unit tests.
 */

package com.voicecap.sms.pdu;

/**
 * Multimedia message PDU (GenericPdu의 필드·메서드를 함께 담았다).
 */
public class MultimediaMessagePdu {
    /**
     * The headers of pdu.
     */
    PduHeaders mPduHeaders = null;

    /**
     * The body of multimedia message.
     */
    private PduBody mMessageBody;

    /**
     * Constructor.
     */
    public MultimediaMessagePdu() {
        mPduHeaders = new PduHeaders();
    }

    /**
     * Get the headers of this PDU.
     *
     * @return A PduHeaders of this PDU.
     */
    PduHeaders getPduHeaders() {
        return mPduHeaders;
    }

    /**
     * Get X-Mms-Message-Type field value.
     *
     * @return the X-Mms-Report-Allowed value
     */
    public int getMessageType() {
        return mPduHeaders.getOctet(PduHeaders.MESSAGE_TYPE);
    }

    /**
     * Set X-Mms-Message-Type field value.
     *
     * @param value the value
     * @throws InvalidHeaderValueException if the value is invalid.
     *         RuntimeException if field's value is not Octet.
     */
    public void setMessageType(int value) throws InvalidHeaderValueException {
        mPduHeaders.setOctet(value, PduHeaders.MESSAGE_TYPE);
    }

    /**
     * Get X-Mms-MMS-Version field value.
     *
     * @return the X-Mms-MMS-Version value
     */
    public int getMmsVersion() {
        return mPduHeaders.getOctet(PduHeaders.MMS_VERSION);
    }

    /**
     * Set X-Mms-MMS-Version field value.
     *
     * @param value the value
     * @throws InvalidHeaderValueException if the value is invalid.
     *         RuntimeException if field's value is not Octet.
     */
    public void setMmsVersion(int value) throws InvalidHeaderValueException {
        mPduHeaders.setOctet(value, PduHeaders.MMS_VERSION);
    }

    /**
     * Get From value.
     * From-value = Value-length
     *      (Address-present-token Encoded-string-value | Insert-address-token)
     *
     * @return the value
     */
    public EncodedStringValue getFrom() {
       return mPduHeaders.getEncodedStringValue(PduHeaders.FROM);
    }

    /**
     * Set From value.
     *
     * @param value the value
     * @throws NullPointerException if the value is null.
     */
    public void setFrom(EncodedStringValue value) {
        mPduHeaders.setEncodedStringValue(value, PduHeaders.FROM);
    }

    /**
     * Get body of the PDU.
     *
     * @return the body
     */
    public PduBody getBody() {
        return mMessageBody;
    }

    /**
     * Set body of the PDU.
     *
     * @param body the body
     */
    public void setBody(PduBody body) {
        mMessageBody = body;
    }

    /**
     * Get subject.
     *
     * @return the value
     */
    public EncodedStringValue getSubject() {
        return mPduHeaders.getEncodedStringValue(PduHeaders.SUBJECT);
    }

    /**
     * Set subject.
     *
     * @param value the value
     * @throws NullPointerException if the value is null.
     */
    public void setSubject(EncodedStringValue value) {
        mPduHeaders.setEncodedStringValue(value, PduHeaders.SUBJECT);
    }

    /**
     * Get To value.
     *
     * @return the value
     */
    public EncodedStringValue[] getTo() {
        return mPduHeaders.getEncodedStringValues(PduHeaders.TO);
    }

    /**
     * Add a "To" value.
     *
     * @param value the value
     * @throws NullPointerException if the value is null.
     */
    public void addTo(EncodedStringValue value) {
        mPduHeaders.appendEncodedStringValue(value, PduHeaders.TO);
    }

    /**
     * Get X-Mms-Priority value.
     *
     * @return the value
     */
    public int getPriority() {
        return mPduHeaders.getOctet(PduHeaders.PRIORITY);
    }

    /**
     * Set X-Mms-Priority value.
     *
     * @param value the value
     * @throws InvalidHeaderValueException if the value is invalid.
     */
    public void setPriority(int value) throws InvalidHeaderValueException {
        mPduHeaders.setOctet(value, PduHeaders.PRIORITY);
    }

    /**
     * Get Date value.
     *
     * @return the value
     */
    public long getDate() {
        return mPduHeaders.getLongInteger(PduHeaders.DATE);
    }

    /**
     * Set Date value in seconds.
     *
     * @param value the value
     */
    public void setDate(long value) {
        mPduHeaders.setLongInteger(value, PduHeaders.DATE);
    }
}
