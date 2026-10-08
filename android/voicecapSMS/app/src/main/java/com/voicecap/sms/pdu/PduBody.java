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

import java.util.Vector;

public class PduBody {
    private Vector<PduPart> mParts = null;

    /**
     * Constructor.
     */
    public PduBody() {
        mParts = new Vector<PduPart>();
    }

    /**
     * Appends the specified part to the end of this body.
     *
     * @param part part to be appended
     * @return true when success, false when fail
     * @throws NullPointerException when part is null
     */
    public boolean addPart(PduPart part) {
        if(null == part) {
            throw new NullPointerException();
        }

        return mParts.add(part);
    }

    /**
     * Get the part at the specified position.
     *
     * @param index index of the part to return
     * @return part at the specified index
     */
    public PduPart getPart(int index) {
        return mParts.get(index);
    }

    /**
     * Get the number of parts.
     *
     * @return the number of parts
     */
    public int getPartsNum() {
        return mParts.size();
    }
}
