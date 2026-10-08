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

import java.io.UnsupportedEncodingException;
import java.util.HashMap;

public class CharacterSets {
    /**
     * IANA assigned MIB enum numbers.
     *
     * From wap-230-wsp-20010705-a.pdf
     * Any-charset = <Octet 128>
     * Equivalent to the special RFC2616 charset value "*"
     */
    public static final int ANY_CHARSET = 0x00;
    public static final int US_ASCII    = 0x03;
    public static final int ISO_8859_1  = 0x04;
    public static final int UTF_8       = 0x6A;
    public static final int UTF_16      = 0x03F7;

    /**
     * If the encoding of given data is unsupported, use UTF_8 to decode it.
     */
    public static final int DEFAULT_CHARSET = UTF_8;

    private static final int[] MIBENUM_NUMBERS = {
        ANY_CHARSET,
        US_ASCII,
        ISO_8859_1,
        UTF_8,
        UTF_16,
    };

    public static final String MIMENAME_ANY_CHARSET = "*";
    public static final String MIMENAME_US_ASCII    = "us-ascii";
    public static final String MIMENAME_ISO_8859_1  = "iso-8859-1";
    public static final String MIMENAME_UTF_8       = "utf-8";
    public static final String MIMENAME_UTF_16      = "utf-16";

    public static final String DEFAULT_CHARSET_NAME = MIMENAME_UTF_8;

    private static final String[] MIME_NAMES = {
        MIMENAME_ANY_CHARSET,
        MIMENAME_US_ASCII,
        MIMENAME_ISO_8859_1,
        MIMENAME_UTF_8,
        MIMENAME_UTF_16,
    };

    private static final HashMap<Integer, String> MIBENUM_TO_NAME_MAP;

    static {
        MIBENUM_TO_NAME_MAP = new HashMap<Integer, String>();
        int count = MIBENUM_NUMBERS.length - 1;
        for (int i = 0; i <= count; i++) {
            MIBENUM_TO_NAME_MAP.put(MIBENUM_NUMBERS[i], MIME_NAMES[i]);
        }
    }

    private CharacterSets() {} // Non-instantiatable

    /**
     * Map an MIBEnum number to the name of the charset which this number
     * is assigned to by IANA.
     *
     * @param mibEnumValue An IANA assigned MIBEnum number.
     * @return The name string of the charset.
     * @throws UnsupportedEncodingException
     */
    public static String getMimeName(int mibEnumValue)
            throws UnsupportedEncodingException {
        String name = MIBENUM_TO_NAME_MAP.get(mibEnumValue);
        if (name == null) {
            throw new UnsupportedEncodingException();
        }
        return name;
    }
}
