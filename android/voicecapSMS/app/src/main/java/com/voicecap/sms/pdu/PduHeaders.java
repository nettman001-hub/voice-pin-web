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

import java.util.ArrayList;
import java.util.HashMap;

public class PduHeaders {
    /**
     * All pdu header fields (only those an m-send-req uses).
     */
    public static final int BCC                             = 0x81;
    public static final int CC                              = 0x82;
    public static final int CONTENT_TYPE                    = 0x84;
    public static final int DATE                            = 0x85;
    public static final int DELIVERY_REPORT                 = 0x86;
    public static final int EXPIRY                          = 0x88;
    public static final int FROM                            = 0x89;
    public static final int MESSAGE_CLASS                   = 0x8A;
    public static final int MESSAGE_ID                      = 0x8B;
    public static final int MESSAGE_TYPE                    = 0x8C;
    public static final int MMS_VERSION                     = 0x8D;
    public static final int MESSAGE_SIZE                    = 0x8E;
    public static final int PRIORITY                        = 0x8F;
    public static final int READ_REPORT                     = 0x90;
    public static final int REPORT_ALLOWED                  = 0x91;
    public static final int SUBJECT                         = 0x96;
    public static final int TO                              = 0x97;
    public static final int TRANSACTION_ID                  = 0x98;

    /**
     * X-Mms-Message-Type field types.
     */
    public static final int MESSAGE_TYPE_SEND_REQ           = 0x80;
    public static final int MESSAGE_TYPE_CANCEL_CONF        = 0x97;

    /**
     *  X-Mms-Delivery-Report |
     *  X-Mms-Read-Report |
     *  X-Mms-Report-Allowed field types.
     */
    public static final int VALUE_YES                       = 0x80;
    public static final int VALUE_NO                        = 0x81;

    /**
     *  Delivery-Time |
     *  Expiry and Reply-Charging-Deadline |
     *  X-Mms-Expiry field types.
     */
    public static final int VALUE_ABSOLUTE_TOKEN            = 0x80;
    public static final int VALUE_RELATIVE_TOKEN            = 0x81;

    /**
     * X-Mms-MMS-Version field types.
     */
    public static final int MMS_VERSION_1_3                 = ((1 << 4) | 3);
    public static final int MMS_VERSION_1_2                 = ((1 << 4) | 2);
    public static final int MMS_VERSION_1_1                 = ((1 << 4) | 1);
    public static final int MMS_VERSION_1_0                 = ((1 << 4) | 0);

    // Current version is 1.2.
    public static final int CURRENT_MMS_VERSION             = MMS_VERSION_1_2;

    /**
     *  From field type components.
     */
    public static final int FROM_ADDRESS_PRESENT_TOKEN      = 0x80;
    public static final int FROM_INSERT_ADDRESS_TOKEN       = 0x81;

    public static final String FROM_ADDRESS_PRESENT_TOKEN_STR = "address-present-token";
    public static final String FROM_INSERT_ADDRESS_TOKEN_STR = "insert-address-token";

    /**
     *  X-Mms-Message-Class field types.
     */
    public static final int MESSAGE_CLASS_PERSONAL          = 0x80;
    public static final int MESSAGE_CLASS_ADVERTISEMENT     = 0x81;
    public static final int MESSAGE_CLASS_INFORMATIONAL     = 0x82;
    public static final int MESSAGE_CLASS_AUTO              = 0x83;

    public static final String MESSAGE_CLASS_PERSONAL_STR = "personal";
    public static final String MESSAGE_CLASS_ADVERTISEMENT_STR = "advertisement";
    public static final String MESSAGE_CLASS_INFORMATIONAL_STR = "informational";
    public static final String MESSAGE_CLASS_AUTO_STR = "auto";

    /**
     *  X-Mms-Priority field types.
     */
    public static final int PRIORITY_LOW                    = 0x80;
    public static final int PRIORITY_NORMAL                 = 0x81;
    public static final int PRIORITY_HIGH                   = 0x82;

    /**
     * The map contains the value of all headers.
     */
    private HashMap<Integer, Object> mHeaderMap = null;

    /**
     * Constructor of PduHeaders.
     */
    public PduHeaders() {
        mHeaderMap = new HashMap<Integer, Object>();
    }

    /**
     * Get octet value by header field.
     *
     * @param field the field
     * @return the octet value of the pdu header
     *          with specified header field. Return 0 if
     *          the value is not set.
     */
    protected int getOctet(int field) {
        Integer octet = (Integer) mHeaderMap.get(field);
        if (null == octet) {
            return 0;
        }

        return octet;
    }

    /**
     * Set octet value to pdu header by header field.
     *
     * @param value the value
     * @param field the field
     * @throws InvalidHeaderValueException if the value is invalid.
     */
    protected void setOctet(int value, int field)
            throws InvalidHeaderValueException{
        /**
         * Check whether this field can be set for specific
         * header and check validity of the field.
         */
        switch (field) {
            case REPORT_ALLOWED:
            case DELIVERY_REPORT:
            case READ_REPORT:
                if ((VALUE_YES != value) && (VALUE_NO != value)) {
                    // Invalid value.
                    throw new InvalidHeaderValueException("Invalid Octet value!");
                }
                break;
            case PRIORITY:
                if ((value < PRIORITY_LOW) || (value > PRIORITY_HIGH)) {
                    // Invalid value.
                    throw new InvalidHeaderValueException("Invalid Octet value!");
                }
                break;
            case MMS_VERSION:
                if ((value < MMS_VERSION_1_0)|| (value > MMS_VERSION_1_3)) {
                    value = CURRENT_MMS_VERSION; // Current version is the default value.
                }
                break;
            case MESSAGE_TYPE:
                if ((value < MESSAGE_TYPE_SEND_REQ) || (value > MESSAGE_TYPE_CANCEL_CONF)) {
                    // Invalid value.
                    throw new InvalidHeaderValueException("Invalid Octet value!");
                }
                break;
            default:
                // This header value should not be Octect.
                throw new RuntimeException("Invalid header field!");
        }
        mHeaderMap.put(field, value);
    }

    /**
     * Get TextString value by header field.
     *
     * @param field the field
     * @return the TextString value of the pdu header
     *          with specified header field
     */
    protected byte[] getTextString(int field) {
        return (byte[]) mHeaderMap.get(field);
    }

    /**
     * Set TextString value to pdu header by header field.
     *
     * @param value the value
     * @param field the field
     * @throws NullPointerException if the value is null.
     */
    protected void setTextString(byte[] value, int field) {
        /**
         * Check whether this field can be set for specific
         * header and check validity of the field.
         */
        if (null == value) {
            throw new NullPointerException();
        }

        switch (field) {
            case TRANSACTION_ID:
            case MESSAGE_ID:
            case MESSAGE_CLASS:
            case CONTENT_TYPE:
                break;
            default:
                // This header value should not be Text-String.
                throw new RuntimeException("Invalid header field!");
        }
        mHeaderMap.put(field, value);
    }

    /**
     * Get EncodedStringValue value by header field.
     *
     * @param field the field
     * @return the EncodedStringValue value of the pdu header
     *          with specified header field
     */
    protected EncodedStringValue getEncodedStringValue(int field) {
        return (EncodedStringValue) mHeaderMap.get(field);
    }

    /**
     * Get TO, CC or BCC header value.
     *
     * @param field the field
     * @return the EncodeStringValue array of the pdu header
     *          with specified header field
     */
    @SuppressWarnings("unchecked")
    protected EncodedStringValue[] getEncodedStringValues(int field) {
        ArrayList<EncodedStringValue> list =
                (ArrayList<EncodedStringValue>) mHeaderMap.get(field);
        if (null == list) {
            return null;
        }
        EncodedStringValue[] values = new EncodedStringValue[list.size()];
        return list.toArray(values);
    }

    /**
     * Set EncodedStringValue value to pdu header by header field.
     *
     * @param value the value
     * @param field the field
     * @throws NullPointerException if the value is null.
     */
    protected void setEncodedStringValue(EncodedStringValue value, int field) {
        /**
         * Check whether this field can be set for specific
         * header and check validity of the field.
         */
        if (null == value) {
            throw new NullPointerException();
        }

        switch (field) {
            case SUBJECT:
            case FROM:
                break;
            default:
                // This header value should not be Encoded-String-Value.
                throw new RuntimeException("Invalid header field!");
        }

        mHeaderMap.put(field, value);
    }

    /**
     * Set TO, CC or BCC header value.
     *
     * @param value the value
     * @param field the field
     * @throws NullPointerException if the value is null.
     */
    protected void setEncodedStringValues(EncodedStringValue[] value, int field) {
        /**
         * Check whether this field can be set for specific
         * header and check validity of the field.
         */
        if (null == value) {
            throw new NullPointerException();
        }

        switch (field) {
            case BCC:
            case CC:
            case TO:
                break;
            default:
                // This header value should not be Encoded-String-Value.
                throw new RuntimeException("Invalid header field!");
        }

        ArrayList<EncodedStringValue> list = new ArrayList<EncodedStringValue>();
        for (int i = 0; i < value.length; i++) {
            list.add(value[i]);
        }
        mHeaderMap.put(field, list);
    }

    /**
     * Append one EncodedStringValue to another.
     *
     * @param value the EncodedStringValue to append
     * @param field the field
     * @throws NullPointerException if the value is null.
     */
    @SuppressWarnings("unchecked")
    protected void appendEncodedStringValue(EncodedStringValue value,
                                    int field) {
        if (null == value) {
            throw new NullPointerException();
        }

        switch (field) {
            case BCC:
            case CC:
            case TO:
                break;
            default:
                throw new RuntimeException("Invalid header field!");
        }

        ArrayList<EncodedStringValue> list =
            (ArrayList<EncodedStringValue>) mHeaderMap.get(field);
        if (null == list) {
            list  = new ArrayList<EncodedStringValue>();
        }
        list.add(value);
        mHeaderMap.put(field, list);
    }

    /**
     * Get LongInteger value by header field.
     *
     * @param field the field
     * @return the LongInteger value of the pdu header
     *          with specified header field. if return -1, the
     *          field is not existed in pdu header.
     */
    protected long getLongInteger(int field) {
        Long longInteger = (Long) mHeaderMap.get(field);
        if (null == longInteger) {
            return -1;
        }

        return longInteger.longValue();
    }

    /**
     * Set LongInteger value to pdu header by header field.
     *
     * @param value the value
     * @param field the field
     */
    protected void setLongInteger(long value, int field) {
        /**
         * Check whether this field can be set for specific
         * header and check validity of the field.
         */
        switch (field) {
            case DATE:
            case MESSAGE_SIZE:
            case EXPIRY:
                break;
            default:
                // This header value should not be LongInteger.
                throw new RuntimeException("Invalid header field!");
        }
        mHeaderMap.put(field, value);
    }
}
