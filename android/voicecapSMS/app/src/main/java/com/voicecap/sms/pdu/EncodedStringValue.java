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

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UnsupportedEncodingException;

/**
 * Encoded-string-value = Text-string | Value-length Char-set Text-string
 */
public class EncodedStringValue {
    /**
     * The Char-set value.
     */
    private int mCharacterSet;

    /**
     * The Text-string value.
     */
    private byte[] mData;

    /**
     * Constructor.
     *
     * @param charset the Char-set value
     * @param data the Text-string value
     * @throws NullPointerException if Text-string value is null.
     */
    public EncodedStringValue(int charset, byte[] data) {
        // TODO: CharSet needs to be validated against MIBEnum.
        if(null == data) {
            throw new NullPointerException("EncodedStringValue: Text-string is null.");
        }

        mCharacterSet = charset;
        mData = new byte[data.length];
        System.arraycopy(data, 0, mData, 0, data.length);
    }

    /**
     * Constructor.
     *
     * @param data the Text-string value
     * @throws NullPointerException if Text-string value is null.
     */
    public EncodedStringValue(byte[] data) {
        this(CharacterSets.DEFAULT_CHARSET, data);
    }

    public EncodedStringValue(String data) {
        try {
            mData = data.getBytes(CharacterSets.DEFAULT_CHARSET_NAME);
            mCharacterSet = CharacterSets.DEFAULT_CHARSET;
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException("Default encoding must be supported.", e);
        }
    }

    /**
     * Get Char-set value.
     *
     * @return the value
     */
    public int getCharacterSet() {
        return mCharacterSet;
    }

    /**
     * Get Text-string value.
     *
     * @return the value
     */
    public byte[] getTextString() {
        byte[] byteArray = new byte[mData.length];

        System.arraycopy(mData, 0, byteArray, 0, mData.length);
        return byteArray;
    }

    /**
     * Convert this object to a {@link java.lang.String}. If the encoding of
     * the EncodedStringValue is null or unsupported, it will be
     * treated as iso-8859-1 encoding.
     *
     * @return The decoded String.
     */
    public String getString()  {
        if (CharacterSets.ANY_CHARSET == mCharacterSet) {
            return new String(mData); // system default encoding.
        } else {
            try {
                String name = CharacterSets.getMimeName(mCharacterSet);
                return new String(mData, name);
            } catch (UnsupportedEncodingException e) {
                try {
                    return new String(mData, CharacterSets.MIMENAME_ISO_8859_1);
                } catch (UnsupportedEncodingException ignored) {
                    return new String(mData); // system default encoding.
                }
            }
        }
    }

    /**
     * Append to Text-string.
     *
     * @param textString the textString to append
     * @throws NullPointerException if the text String is null
     *                      or an IOException occured.
     */
    public void appendTextString(byte[] textString) {
        if(null == textString) {
            throw new NullPointerException("Text-string is null.");
        }

        if(null == mData) {
            mData = new byte[textString.length];
            System.arraycopy(textString, 0, mData, 0, textString.length);
        } else {
            ByteArrayOutputStream newTextString = new ByteArrayOutputStream();
            try {
                newTextString.write(mData);
                newTextString.write(textString);
            } catch (IOException e) {
                throw new NullPointerException(
                        "appendTextString: failed when write a new Text-string");
            }

            mData = newTextString.toByteArray();
        }
    }

    public static EncodedStringValue copy(EncodedStringValue value) {
        if (value == null) {
            return null;
        }

        return new EncodedStringValue(value.mCharacterSet, value.mData);
    }
}
