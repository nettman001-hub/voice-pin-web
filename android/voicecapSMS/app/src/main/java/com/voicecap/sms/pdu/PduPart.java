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

import java.util.HashMap;
import java.util.Map;

/**
 * The pdu part. (Uri 대신 바이트로만 데이터를 담는다.)
 */
public class PduPart {
    /**
     * Well-Known Parameters.
     */
    public static final int P_CHARSET            = 0x81;
    public static final int P_DEP_NAME           = 0x85;
    public static final int P_DEP_FILENAME       = 0x86;
    // This value of "TYPE" s used with Content-Type: multipart/related
    public static final int P_CT_MR_TYPE         = 0x89;
    public static final int P_DEP_START          = 0x8A;
    public static final int P_NAME               = 0x97;
    public static final int P_FILENAME           = 0x98;

    /**
     * Header field names.
     */
     public static final int P_CONTENT_TYPE       = 0x91;
     public static final int P_CONTENT_LOCATION   = 0x8E;
     public static final int P_CONTENT_ID         = 0xC0;

     /**
      * Header of part.
      */
     private Map<Integer, Object> mPartHeader = null;

     /**
      * Data of part.
      */
     private byte[] mPartData = null;

     /**
      * Empty Constructor.
      */
     public PduPart() {
         mPartHeader = new HashMap<Integer, Object>();
     }

     /**
      * Set part data. The data are stored as byte array.
      *
      * @param data the data
      */
     public void setData(byte[] data) {
         if(data == null) {
            return;
        }

         mPartData = new byte[data.length];
         System.arraycopy(data, 0, mPartData, 0, data.length);
     }

     /**
      * @return A copy of the part data or null if the data wasn't set or
      *         the data is stored as Uri.
      */
     public byte[] getData() {
         if(mPartData == null) {
            return null;
         }

         byte[] byteArray = new byte[mPartData.length];
         System.arraycopy(mPartData, 0, byteArray, 0, mPartData.length);
         return byteArray;
     }

     /**
      * Set Content-id value
      *
      * @param contentId the content-id value
      * @throws NullPointerException if the value is null.
      */
     public void setContentId(byte[] contentId) {
         if((contentId == null) || (contentId.length == 0)) {
             throw new IllegalArgumentException(
                     "Content-Id may not be null or empty.");
         }

         if ((contentId.length > 1)
                 && ((char) contentId[0] == '<')
                 && ((char) contentId[contentId.length - 1] == '>')) {
             mPartHeader.put(P_CONTENT_ID, contentId);
             return;
         }

         // Insert beginning '<' and trailing '>' for Content-Id.
         byte[] buffer = new byte[contentId.length + 2];
         buffer[0] = (byte) (0xff & '<');
         buffer[buffer.length - 1] = (byte) (0xff & '>');
         System.arraycopy(contentId, 0, buffer, 1, contentId.length);
         mPartHeader.put(P_CONTENT_ID, buffer);
     }

     /**
      * Get Content-id value.
      *
      * @return the value
      */
     public byte[] getContentId() {
         return (byte[]) mPartHeader.get(P_CONTENT_ID);
     }

     /**
      * Set Char-set value.
      *
      * @param charset the value
      */
     public void setCharset(int charset) {
         mPartHeader.put(P_CHARSET, charset);
     }

     /**
      * Get Char-set value
      *
      * @return the charset value. Return 0 if charset was not set.
      */
     public int getCharset() {
         Integer charset = (Integer) mPartHeader.get(P_CHARSET);
         if(charset == null) {
             return 0;
         } else {
             return charset.intValue();
         }
     }

     /**
      * Set Content-Location value.
      *
      * @param contentLocation the value
      * @throws NullPointerException if the value is null.
      */
     public void setContentLocation(byte[] contentLocation) {
         if(contentLocation == null) {
             throw new NullPointerException("null content-location");
         }

         mPartHeader.put(P_CONTENT_LOCATION, contentLocation);
     }

     /**
      * Get Content-Location value.
      *
      * @return the value
      *     return PduPart.disposition[0] instead of <Octet 128> (Form-data).
      *     return PduPart.disposition[1] instead of <Octet 129> (Attachment).
      *     return PduPart.disposition[2] instead of <Octet 130> (Inline).
      */
     public byte[] getContentLocation() {
         return (byte[]) mPartHeader.get(P_CONTENT_LOCATION);
     }

     /**
      * Set Content-Type value.
      *
      * @param contentType the value
      * @throws NullPointerException if the value is null.
      */
     public void setContentType(byte[] contentType) {
         if(contentType == null) {
             throw new NullPointerException("null content-type");
         }

         mPartHeader.put(P_CONTENT_TYPE, contentType);
     }

     /**
      * Get Content-Type value of part.
      *
      * @return the value
      */
     public byte[] getContentType() {
         return (byte[]) mPartHeader.get(P_CONTENT_TYPE);
     }

     /**
      * Set Content-type parameter: name.
      *
      * @param name the name value
      * @throws NullPointerException if the value is null.
      */
     public void setName(byte[] name) {
         if(null == name) {
             throw new NullPointerException("null content-id");
         }

         mPartHeader.put(P_NAME, name);
     }

     /**
      *  Get content-type parameter: name.
      *
      *  @return the name
      */
     public byte[] getName() {
         return (byte[]) mPartHeader.get(P_NAME);
     }

     /**
      * Get Content-disposition parameter: filename
      *
      * @param fileName the filename value
      * @throws NullPointerException if the value is null.
      */
     public void setFilename(byte[] fileName) {
         if(null == fileName) {
             throw new NullPointerException("null content-id");
         }

         mPartHeader.put(P_FILENAME, fileName);
     }

     /**
      * Set Content-disposition parameter: filename
      *
      * @return the filename
      */
     public byte[] getFilename() {
         return (byte[]) mPartHeader.get(P_FILENAME);
     }
}
