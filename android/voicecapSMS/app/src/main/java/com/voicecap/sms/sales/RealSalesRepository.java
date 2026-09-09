package com.voicecap.sms.sales;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import com.voicecap.sms.BridgePreferences;
import com.voicecap.sms.sales.model.SalesModels.*;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RealSalesRepository implements SalesRepository {
    private final Context context;
    private final String baseUrl;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final SharedPreferences opStore;

    public RealSalesRepository(Context context) {
        this.context = context.getApplicationContext();
        String apiBase = BridgePreferences.apiBaseUrl();
        this.baseUrl = apiBase.endsWith("/") ? apiBase + "sales-api" : apiBase + "/sales-api";
        this.opStore = this.context.getSharedPreferences("voicecap_sales_ops", Context.MODE_PRIVATE);
    }

    private void postAction(String action, JSONObject body, Callback<JSONObject> callback) {
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                String opId = body.optString("operationId", null);
                if (opId != null) {
                    opStore.edit().putString(opId, body.toString()).apply();
                }

                URL url = new URL(baseUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("Accept", "application/json");

                String deviceToken = BridgePreferences.value(context, BridgePreferences.DEVICE_TOKEN);
                if (deviceToken != null && !deviceToken.isEmpty()) {
                    conn.setRequestProperty("X-VoiceCAP-Device-Token", deviceToken);
                }

                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);
                conn.setDoOutput(true);

                body.put("action", action);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                }

                int statusCode = conn.getResponseCode();
                InputStream is = (statusCode >= 200 && statusCode < 300) ? conn.getInputStream() : conn.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (is != null) {
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) sb.append(line);
                    }
                }

                JSONObject resObj = new JSONObject(sb.length() > 0 ? sb.toString() : "{}");
                boolean ok = resObj.optBoolean("ok", false);

                if (ok) {
                    JSONObject data = resObj.optJSONObject("data");
                    mainHandler.post(() -> callback.onSuccess(data != null ? data : new JSONObject()));
                } else {
                    JSONObject errObj = resObj.optJSONObject("error");
                    SalesError error = SalesError.fromJson(errObj);
                    mainHandler.post(() -> callback.onError(error));
                }
            } catch (Exception e) {
                SalesError error = new SalesError("NETWORK_ERROR", e.getMessage() != null ? e.getMessage() : "네트워크 통신 오류", true, null);
                mainHandler.post(() -> callback.onError(error));
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @Override
    public void getBootstrap(Callback<BootstrapData> callback) {
        JSONObject body = new JSONObject();
        postAction("get-bootstrap", body, new Callback<JSONObject>() {
            @Override
            public void onSuccess(JSONObject data) {
                callback.onSuccess(BootstrapData.fromJson(data));
            }
            @Override
            public void onError(SalesError error) {
                callback.onError(error);
            }
        });
    }

    @Override
    public void getSalesFeed(String sessionId, List<String> watchedBuyerIds, String sinceCursor, Callback<SalesFeedData> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("sessionId", sessionId);
            if (watchedBuyerIds != null && !watchedBuyerIds.isEmpty()) {
                JSONArray arr = new JSONArray();
                for (String id : watchedBuyerIds) arr.put(id);
                body.put("watchedBuyerIds", arr);
            }
            if (sinceCursor != null) body.put("sinceCursor", sinceCursor);

            postAction("get-sales-feed", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(SalesFeedData.fromJson(data));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void updateSettings(String operationId, int expectedRevision, Settings settings, Callback<Settings> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            body.put("expectedRevision", expectedRevision);
            body.put("settings", settings.toJson());

            postAction("update-settings", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(Settings.fromJson(data.optJSONObject("settings")));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void prepareProduct(String operationId, String sessionId, Integer expectedSessionRevision, String requestedProductCode, String name, Long unitPrice, String imageKind, Callback<PrepareProductResult> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            body.put("sessionId", sessionId);
            if (expectedSessionRevision != null) body.put("expectedSessionRevision", expectedSessionRevision);
            if (requestedProductCode != null) body.put("requestedProductCode", requestedProductCode);
            if (name != null) body.put("name", name);
            if (unitPrice != null) body.put("unitPrice", unitPrice);
            if (imageKind != null) body.put("imageKind", imageKind);

            postAction("prepare-product", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(PrepareProductResult.fromJson(data));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void uploadProductImage(String uploadUrl, byte[] jpegData, Callback<Void> callback) {
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                if (uploadUrl == null || uploadUrl.trim().isEmpty()) {
                    throw new IllegalArgumentException("상품 이미지 업로드 주소가 없습니다.");
                }
                if (jpegData == null || jpegData.length == 0) {
                    throw new IllegalArgumentException("촬영된 상품 이미지가 없습니다.");
                }
                if (jpegData.length > 4 * 1024 * 1024) {
                    throw new IllegalArgumentException("상품 이미지는 4MB 이하여야 합니다.");
                }

                conn = (HttpURLConnection) new URL(uploadUrl).openConnection();
                conn.setRequestMethod("PUT");
                conn.setRequestProperty("Content-Type", "image/jpeg");
                conn.setRequestProperty("Cache-Control", "max-age=3600");
                conn.setRequestProperty("x-upsert", "false");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(jpegData.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(jpegData);
                }

                int statusCode = conn.getResponseCode();
                if (statusCode < 200 || statusCode >= 300) {
                    InputStream errorStream = conn.getErrorStream();
                    String detail = "";
                    if (errorStream != null) {
                        try (BufferedReader reader = new BufferedReader(new InputStreamReader(errorStream, StandardCharsets.UTF_8))) {
                            StringBuilder builder = new StringBuilder();
                            String line;
                            while ((line = reader.readLine()) != null) builder.append(line);
                            detail = builder.toString();
                        }
                    }
                    throw new IllegalStateException("상품 이미지 업로드 실패 (" + statusCode + ")" + (detail.isEmpty() ? "" : ": " + detail));
                }
                mainHandler.post(() -> callback.onSuccess(null));
            } catch (Exception e) {
                SalesError error = new SalesError("IMAGE_UPLOAD_FAILED", e.getMessage() != null ? e.getMessage() : "상품 이미지 업로드 오류", true, null);
                mainHandler.post(() -> callback.onError(error));
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @Override
    public void updateProductDraft(String operationId, String draftId, int expectedDraftRevision, String imageKind, boolean imageFallbackConfirmed, Callback<DraftData> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            body.put("draftId", draftId);
            body.put("expectedDraftRevision", expectedDraftRevision);
            body.put("imageKind", imageKind);
            body.put("imageFallbackConfirmed", imageFallbackConfirmed);

            postAction("update-product-draft", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(DraftData.fromJson(data.optJSONObject("draft")));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void commitProduct(String operationId, String draftId, int expectedDraftRevision, int expectedSessionRevision, Callback<CommitProductResult> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            body.put("draftId", draftId);
            body.put("expectedDraftRevision", expectedDraftRevision);
            body.put("expectedSessionRevision", expectedSessionRevision);

            postAction("commit-product", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(CommitProductResult.fromJson(data));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void commitSales(String operationId, String sessionId, String productId, int expectedProductRevision, int expectedSessionRevision, List<CommitSaleBuyer> buyers, Callback<SalesResult> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            body.put("sessionId", sessionId);
            body.put("productId", productId);
            body.put("expectedProductRevision", expectedProductRevision);
            body.put("expectedSessionRevision", expectedSessionRevision);

            JSONArray bArr = new JSONArray();
            for (CommitSaleBuyer b : buyers) bArr.put(b.toJson());
            body.put("buyers", bArr);

            postAction("commit-sales", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(SalesResult.fromJson(data));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void getOperation(String operationId, Callback<Object> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            postAction("get-operation", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(data);
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void getPrintStatus(String sessionId, Callback<List<PrintJobInfo>> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("sessionId", sessionId);
            postAction("get-print-status", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    List<PrintJobInfo> list = new ArrayList<>();
                    JSONArray arr = data.optJSONArray("printJobs");
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) {
                            list.add(PrintJobInfo.fromJson(arr.optJSONObject(i)));
                        }
                    }
                    callback.onSuccess(list);
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void searchBuyers(String query, Callback<List<Buyer>> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("query", query);
            postAction("search-buyers", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    List<Buyer> list = new ArrayList<>();
                    JSONArray arr = data.optJSONArray("buyers");
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) {
                            list.add(Buyer.fromJson(arr.optJSONObject(i)));
                        }
                    }
                    callback.onSuccess(list);
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void confirmBuyer(String operationId, String displayNickname, String selectedBuyerId, String reason, Callback<Buyer> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            body.put("displayNickname", displayNickname);
            if (selectedBuyerId != null) body.put("selectedBuyerId", selectedBuyerId);
            if (reason != null) body.put("confirmationReason", reason);

            postAction("confirm-buyer", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(Buyer.fromJson(data.optJSONObject("buyer")));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void listSessionProducts(String sessionId, Callback<List<Product>> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("sessionId", sessionId);
            postAction("list-session-products", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    List<Product> list = new ArrayList<>();
                    JSONArray arr = data.optJSONArray("products");
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) list.add(Product.fromJson(arr.optJSONObject(i)));
                    }
                    callback.onSuccess(list);
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void getProductSales(String sessionId, String productId, Callback<List<ProductSale>> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("sessionId", sessionId);
            body.put("productId", productId);
            postAction("get-product-sales", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    List<ProductSale> list = new ArrayList<>();
                    JSONArray arr = data.optJSONArray("sales");
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) list.add(ProductSale.fromJson(arr.optJSONObject(i)));
                    }
                    callback.onSuccess(list);
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void previewProductChange(String productId, int expectedProductRevision, int expectedSalesRevision, Long proposedUnitPrice, List<ProposedSale> proposedSales, Callback<PreviewChangeResult> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("productId", productId);
            body.put("expectedProductRevision", expectedProductRevision);
            body.put("expectedSalesRevision", expectedSalesRevision);

            if (proposedUnitPrice != null) {
                JSONObject prod = new JSONObject();
                prod.put("unitPrice", proposedUnitPrice);
                body.put("proposedProduct", prod);
            }

            if (proposedSales != null) {
                JSONArray sArr = new JSONArray();
                for (ProposedSale ps : proposedSales) sArr.put(ps.toJson());
                body.put("proposedSales", sArr);
            }

            postAction("preview-product-change", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(PreviewChangeResult.fromJson(data));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }

    @Override
    public void commitProductChange(String operationId, String previewToken, Callback<CommitProductChangeResult> callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("operationId", operationId);
            body.put("previewToken", previewToken);

            postAction("commit-product-change", body, new Callback<JSONObject>() {
                @Override
                public void onSuccess(JSONObject data) {
                    callback.onSuccess(CommitProductChangeResult.fromJson(data));
                }
                @Override
                public void onError(SalesError error) {
                    callback.onError(error);
                }
            });
        } catch (Exception e) {
            callback.onError(new SalesError("REQUEST_ERROR", e.getMessage(), false, null));
        }
    }
}
