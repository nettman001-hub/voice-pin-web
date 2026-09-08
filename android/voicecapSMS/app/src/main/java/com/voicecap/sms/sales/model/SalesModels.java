package com.voicecap.sms.sales.model;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.*;

public final class SalesModels {
    private SalesModels() {}

    public static final class Product {
        public final String id;
        public final String productCode;
        public final String name;
        public final Long unitPrice;
        public final String imageKind;
        public final String imageUrl;
        public final int revision;
        public final int salesRevision;

        public Product(String id, String productCode, String name, Long unitPrice, String imageKind, String imageUrl, int revision, int salesRevision) {
            this.id = id;
            this.productCode = productCode;
            this.name = name;
            this.unitPrice = unitPrice;
            this.imageKind = imageKind;
            this.imageUrl = imageUrl;
            this.revision = revision;
            this.salesRevision = salesRevision;
        }

        public static Product fromJson(JSONObject json) {
            if (json == null) return null;
            return new Product(
                json.optString("id", ""),
                json.optString("productCode", ""),
                json.has("name") && !json.isNull("name") ? json.optString("name") : null,
                json.has("unitPrice") && !json.isNull("unitPrice") ? json.optLong("unitPrice") : null,
                json.optString("imageKind", "PHOTO"),
                json.has("imageUrl") && !json.isNull("imageUrl") ? json.optString("imageUrl") : null,
                json.optInt("revision", 1),
                json.optInt("salesRevision", 0)
            );
        }
    }

    public static final class LiveSession {
        public final String id;
        public final String displayCode;
        public final String status;
        public final String activeProductId;
        public final int revision;
        public final String startedAt;

        public LiveSession(String id, String displayCode, String status, String activeProductId, int revision, String startedAt) {
            this.id = id;
            this.displayCode = displayCode;
            this.status = status;
            this.activeProductId = activeProductId;
            this.revision = revision;
            this.startedAt = startedAt;
        }

        public static LiveSession fromJson(JSONObject json) {
            if (json == null) return null;
            return new LiveSession(
                json.optString("id", ""),
                json.optString("displayCode", ""),
                json.optString("status", "ACTIVE"),
                json.has("activeProductId") && !json.isNull("activeProductId") ? json.optString("activeProductId") : null,
                json.optInt("revision", 1),
                json.optString("startedAt", "")
            );
        }
    }

    public static final class LiveComment {
        public final String id;
        public final String sessionId;
        public final String collectorId;
        public final String platformMessageId;
        public final String buyerId;
        public final String nicknameSnapshot;
        public final String content;
        public final String capturedAt;
        public final long ingestSequence;

        public LiveComment(String id, String sessionId, String collectorId, String platformMessageId, String buyerId, String nicknameSnapshot, String content, String capturedAt, long ingestSequence) {
            this.id = id;
            this.sessionId = sessionId;
            this.collectorId = collectorId;
            this.platformMessageId = platformMessageId;
            this.buyerId = buyerId;
            this.nicknameSnapshot = nicknameSnapshot;
            this.content = content;
            this.capturedAt = capturedAt;
            this.ingestSequence = ingestSequence;
        }

        public static LiveComment fromJson(JSONObject json) {
            if (json == null) return null;
            return new LiveComment(
                json.optString("id", ""),
                json.optString("sessionId", ""),
                json.optString("collectorId", ""),
                json.optString("platformMessageId", ""),
                json.has("buyerId") && !json.isNull("buyerId") ? json.optString("buyerId") : null,
                json.optString("nicknameSnapshot", ""),
                json.optString("content", ""),
                json.optString("capturedAt", ""),
                json.optLong("ingestSequence", 0)
            );
        }
    }

    public static final class BuyerStats {
        public final String buyerId;
        public final String displayNickname;
        public final int sessionQuantity;
        public final long sessionAmount;
        public final int totalPurchaseCount;
        public final long totalPurchaseAmount;

        public BuyerStats(String buyerId, String displayNickname, int sessionQuantity, long sessionAmount, int totalPurchaseCount, long totalPurchaseAmount) {
            this.buyerId = buyerId;
            this.displayNickname = displayNickname;
            this.sessionQuantity = sessionQuantity;
            this.sessionAmount = sessionAmount;
            this.totalPurchaseCount = totalPurchaseCount;
            this.totalPurchaseAmount = totalPurchaseAmount;
        }

        public static BuyerStats fromJson(JSONObject json) {
            if (json == null) return null;
            return new BuyerStats(
                json.optString("buyerId", ""),
                json.optString("displayNickname", ""),
                json.optInt("sessionQuantity", 0),
                json.optLong("sessionAmount", 0),
                json.optInt("totalPurchaseCount", 0),
                json.optLong("totalPurchaseAmount", 0)
            );
        }
    }

    public static final class SalesSummary {
        public final int sessionQuantity;
        public final long sessionAmount;

        public SalesSummary(int sessionQuantity, long sessionAmount) {
            this.sessionQuantity = sessionQuantity;
            this.sessionAmount = sessionAmount;
        }

        public static SalesSummary fromJson(JSONObject json) {
            if (json == null) return new SalesSummary(0, 0);
            return new SalesSummary(
                json.optInt("sessionQuantity", 0),
                json.optLong("sessionAmount", 0)
            );
        }
    }

    public static final class Settings {
        public final int revision;
        public final boolean productRegistrationEnabled;
        public final boolean captureProductImageEnabled;
        public final boolean productNameInputEnabled;
        public final int voicePreviewMs;

        public Settings(int revision, boolean productRegistrationEnabled, boolean captureProductImageEnabled, boolean productNameInputEnabled, int voicePreviewMs) {
            this.revision = revision;
            this.productRegistrationEnabled = productRegistrationEnabled;
            this.captureProductImageEnabled = captureProductImageEnabled;
            this.productNameInputEnabled = productNameInputEnabled;
            this.voicePreviewMs = voicePreviewMs;
        }

        public static Settings fromJson(JSONObject json) {
            if (json == null) return new Settings(1, true, true, true, 2500);
            return new Settings(
                json.optInt("revision", 1),
                json.optBoolean("productRegistrationEnabled", true),
                json.optBoolean("captureProductImageEnabled", true),
                json.optBoolean("productNameInputEnabled", true),
                json.optInt("voicePreviewMs", 2500)
            );
        }

        public JSONObject toJson() {
            try {
                JSONObject json = new JSONObject();
                json.put("revision", revision);
                json.put("productRegistrationEnabled", productRegistrationEnabled);
                json.put("captureProductImageEnabled", captureProductImageEnabled);
                json.put("productNameInputEnabled", productNameInputEnabled);
                json.put("voicePreviewMs", voicePreviewMs);
                return json;
            } catch (Exception e) {
                return new JSONObject();
            }
        }
    }

    public static final class PrinterStatus {
        public final String outputDeviceId;
        public final String outputDeviceName;
        public final boolean online;
        public final int queuedJobsCount;

        public PrinterStatus(String outputDeviceId, String outputDeviceName, boolean online, int queuedJobsCount) {
            this.outputDeviceId = outputDeviceId;
            this.outputDeviceName = outputDeviceName;
            this.online = online;
            this.queuedJobsCount = queuedJobsCount;
        }

        public static PrinterStatus fromJson(JSONObject json) {
            if (json == null) return new PrinterStatus(null, null, false, 0);
            return new PrinterStatus(
                json.has("outputDeviceId") && !json.isNull("outputDeviceId") ? json.optString("outputDeviceId") : null,
                json.has("outputDeviceName") && !json.isNull("outputDeviceName") ? json.optString("outputDeviceName") : null,
                json.optBoolean("online", false),
                json.optInt("queuedJobsCount", 0)
            );
        }
    }

    public static final class BootstrapData {
        public final String workspaceId;
        public final Settings settings;
        public final LiveSession activeSession;
        public final Product activeProduct;
        public final PrinterStatus printerStatus;
        public final Set<String> permissions;

        public BootstrapData(String workspaceId, Settings settings, LiveSession activeSession, Product activeProduct, PrinterStatus printerStatus, Set<String> permissions) {
            this.workspaceId = workspaceId;
            this.settings = settings;
            this.activeSession = activeSession;
            this.activeProduct = activeProduct;
            this.printerStatus = printerStatus;
            this.permissions = permissions;
        }

        public static BootstrapData fromJson(JSONObject json) {
            if (json == null) return null;
            Set<String> perms = new HashSet<>();
            JSONArray arr = json.optJSONArray("permissions");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    perms.add(arr.optString(i));
                }
            }

            return new BootstrapData(
                json.optString("workspaceId", ""),
                Settings.fromJson(json.optJSONObject("settings")),
                LiveSession.fromJson(json.optJSONObject("activeSession")),
                Product.fromJson(json.optJSONObject("activeProduct")),
                PrinterStatus.fromJson(json.optJSONObject("printerStatus")),
                perms
            );
        }
    }

    public static final class SalesFeedData {
        public final List<LiveComment> comments;
        public final Map<String, BuyerStats> buyerStats;
        public final SalesSummary summary;
        public final Product activeProduct;
        public final int sessionRevision;
        public final String nextCursor;
        public final boolean hasMore;

        public SalesFeedData(List<LiveComment> comments, Map<String, BuyerStats> buyerStats, SalesSummary summary, Product activeProduct, int sessionRevision, String nextCursor, boolean hasMore) {
            this.comments = comments;
            this.buyerStats = buyerStats;
            this.summary = summary;
            this.activeProduct = activeProduct;
            this.sessionRevision = sessionRevision;
            this.nextCursor = nextCursor;
            this.hasMore = hasMore;
        }

        public static SalesFeedData fromJson(JSONObject json) {
            if (json == null) return null;
            List<LiveComment> list = new ArrayList<>();
            JSONArray arr = json.optJSONArray("comments");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    list.add(LiveComment.fromJson(arr.optJSONObject(i)));
                }
            }

            Map<String, BuyerStats> statsMap = new HashMap<>();
            JSONObject statsObj = json.optJSONObject("buyerStats");
            if (statsObj != null) {
                Iterator<String> keys = statsObj.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    statsMap.put(k, BuyerStats.fromJson(statsObj.optJSONObject(k)));
                }
            }

            return new SalesFeedData(
                list,
                statsMap,
                SalesSummary.fromJson(json.optJSONObject("summary")),
                Product.fromJson(json.optJSONObject("activeProduct")),
                json.optInt("sessionRevision", 1),
                json.has("nextCursor") && !json.isNull("nextCursor") ? json.optString("nextCursor") : null,
                json.optBoolean("hasMore", false)
            );
        }
    }

    public static final class Buyer {
        public final String id;
        public final String platform;
        public final String platformUserId;
        public final String displayNickname;
        public final String identityStatus;

        public Buyer(String id, String platform, String platformUserId, String displayNickname, String identityStatus) {
            this.id = id;
            this.platform = platform;
            this.platformUserId = platformUserId;
            this.displayNickname = displayNickname;
            this.identityStatus = identityStatus;
        }

        public static Buyer fromJson(JSONObject json) {
            if (json == null) return null;
            return new Buyer(
                json.optString("id", ""),
                json.optString("platform", "TIKTOK"),
                json.has("platformUserId") && !json.isNull("platformUserId") ? json.optString("platformUserId") : null,
                json.optString("displayNickname", ""),
                json.optString("identityStatus", "UNRESOLVED")
            );
        }
    }

    public static final class CommitSaleBuyer {
        public final String buyerId;
        public final int quantity;
        public final List<String> sourceCommentIds;

        public CommitSaleBuyer(String buyerId, int quantity, List<String> sourceCommentIds) {
            this.buyerId = buyerId;
            this.quantity = quantity;
            this.sourceCommentIds = sourceCommentIds != null ? sourceCommentIds : Collections.emptyList();
        }

        public JSONObject toJson() {
            try {
                JSONObject json = new JSONObject();
                json.put("buyerId", buyerId);
                json.put("quantity", quantity);
                JSONArray arr = new JSONArray();
                for (String cId : sourceCommentIds) arr.put(cId);
                json.put("sourceCommentIds", arr);
                return json;
            } catch (Exception e) {
                return new JSONObject();
            }
        }
    }

    public static final class SalesResult {
        public final List<String> saleIds;
        public final int totalQuantity;
        public final long totalAmount;
        public final SalesSummary summary;
        public final Map<String, BuyerStats> buyerStats;
        public final List<PrintJobInfo> printJobs;

        public SalesResult(List<String> saleIds, int totalQuantity, long totalAmount, SalesSummary summary, Map<String, BuyerStats> buyerStats, List<PrintJobInfo> printJobs) {
            this.saleIds = saleIds;
            this.totalQuantity = totalQuantity;
            this.totalAmount = totalAmount;
            this.summary = summary;
            this.buyerStats = buyerStats;
            this.printJobs = printJobs;
        }

        public static SalesResult fromJson(JSONObject json) {
            if (json == null) return null;
            List<String> sIds = new ArrayList<>();
            JSONArray arr = json.optJSONArray("saleIds");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) sIds.add(arr.optString(i));
            }

            Map<String, BuyerStats> statsMap = new HashMap<>();
            JSONObject statsObj = json.optJSONObject("buyerStats");
            if (statsObj != null) {
                Iterator<String> keys = statsObj.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    statsMap.put(k, BuyerStats.fromJson(statsObj.optJSONObject(k)));
                }
            }

            List<PrintJobInfo> pjList = new ArrayList<>();
            JSONArray pjArr = json.optJSONArray("printJobs");
            if (pjArr != null) {
                for (int i = 0; i < pjArr.length(); i++) {
                    pjList.add(PrintJobInfo.fromJson(pjArr.optJSONObject(i)));
                }
            }

            return new SalesResult(
                sIds,
                json.optInt("totalQuantity", 0),
                json.optLong("totalAmount", 0),
                SalesSummary.fromJson(json.optJSONObject("summary")),
                statsMap,
                pjList
            );
        }
    }

    public static final class PrintJobInfo {
        public final String id;
        public final String status;
        public final String saleId;
        public final String buyerNickname;
        public final long amount;

        public PrintJobInfo(String id, String status, String saleId, String buyerNickname, long amount) {
            this.id = id;
            this.status = status;
            this.saleId = saleId;
            this.buyerNickname = buyerNickname;
            this.amount = amount;
        }

        public static PrintJobInfo fromJson(JSONObject json) {
            if (json == null) return null;
            return new PrintJobInfo(
                json.optString("id", ""),
                json.optString("status", "QUEUED"),
                json.optString("saleId", ""),
                json.optString("buyerNickname", ""),
                json.optLong("amount", 0)
            );
        }
    }

    public static final class SalesError extends Exception {
        public final String code;
        public final boolean retryable;
        public final JSONObject details;

        public SalesError(String code, String message, boolean retryable, JSONObject details) {
            super(message);
            this.code = code;
            this.retryable = retryable;
            this.details = details != null ? details : new JSONObject();
        }

        public static SalesError fromJson(JSONObject errorObj) {
            if (errorObj == null) return new SalesError("UNKNOWN_ERROR", "알 수 없는 오류가 발생했습니다.", false, null);
            return new SalesError(
                errorObj.optString("code", "UNKNOWN_ERROR"),
                errorObj.optString("message", "오류가 발생했습니다."),
                errorObj.optBoolean("retryable", false),
                errorObj.optJSONObject("details")
            );
        }
    }

    public static final class PrepareProductResult {
        public final String draftId;
        public final int draftRevision;
        public final String productId;
        public final String productCode;
        public final String uploadUrl;
        public final String expiresAt;

        public PrepareProductResult(String draftId, int draftRevision, String productId, String productCode, String uploadUrl, String expiresAt) {
            this.draftId = draftId;
            this.draftRevision = draftRevision;
            this.productId = productId;
            this.productCode = productCode;
            this.uploadUrl = uploadUrl;
            this.expiresAt = expiresAt;
        }

        public static PrepareProductResult fromJson(JSONObject json) {
            if (json == null) return null;
            JSONObject upload = json.optJSONObject("imageUpload");
            return new PrepareProductResult(
                json.optString("draftId", ""),
                json.optInt("draftRevision", 1),
                json.optString("productId", ""),
                json.optString("productCode", ""),
                upload != null ? upload.optString("uploadUrl", "") : null,
                json.optString("expiresAt", "")
            );
        }
    }

    public static final class DraftData {
        public final String id;
        public final int draftRevision;
        public final String productId;
        public final String productCode;
        public final String name;
        public final Long unitPrice;
        public final String imageKind;
        public final String status;

        public DraftData(String id, int draftRevision, String productId, String productCode, String name, Long unitPrice, String imageKind, String status) {
            this.id = id;
            this.draftRevision = draftRevision;
            this.productId = productId;
            this.productCode = productCode;
            this.name = name;
            this.unitPrice = unitPrice;
            this.imageKind = imageKind;
            this.status = status;
        }

        public static DraftData fromJson(JSONObject json) {
            if (json == null) return null;
            return new DraftData(
                json.optString("id", ""),
                json.optInt("draftRevision", 1),
                json.optString("productId", ""),
                json.optString("productCode", ""),
                json.has("name") && !json.isNull("name") ? json.optString("name") : null,
                json.has("unitPrice") && !json.isNull("unitPrice") ? json.optLong("unitPrice") : null,
                json.optString("imageKind", "PHOTO"),
                json.optString("status", "READY")
            );
        }
    }

    public static final class CommitProductResult {
        public final Product product;
        public final LiveSession session;

        public CommitProductResult(Product product, LiveSession session) {
            this.product = product;
            this.session = session;
        }

        public static CommitProductResult fromJson(JSONObject json) {
            if (json == null) return null;
            return new CommitProductResult(
                Product.fromJson(json.optJSONObject("product")),
                LiveSession.fromJson(json.optJSONObject("session"))
            );
        }
    }
}
