package com.voicecap.sms.sales;

import com.voicecap.sms.sales.model.SalesModels.*;
import org.json.JSONObject;
import java.util.*;

public class FakeSalesRepository implements SalesRepository {
    private Settings settings = new Settings(1, true, true, true, 2500);
    private LiveSession session = new LiveSession("33333333-3333-4333-8333-333333333333", "2026-09-08 라이브 1회차", "ACTIVE", "55555555-5555-4555-8555-555555555555", 8, "2026-09-08T08:00:00.000Z");
    private Product activeProduct = new Product("55555555-5555-4555-8555-555555555555", "P-20260907-000123", "123번 니트", 20000L, "PHOTO", "https://storage.voicecap.local/products/p101.jpg", 2, 0);
    private PrinterStatus printerStatus = new PrinterStatus("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "포스 프린터 메인 (POS-80)", true, 0);
    private Set<String> permissions = new HashSet<>(Arrays.asList("SALES_READ", "SALES_WRITE", "PRODUCT_WRITE"));

    private final List<LiveComment> comments = new ArrayList<>();
    private final Map<String, BuyerStats> buyerStats = new HashMap<>();
    private SalesSummary summary = new SalesSummary(2, 40000L);
    private final Map<String, DraftData> drafts = new HashMap<>();

    public FakeSalesRepository() {
        // Initial fixture comments
        comments.add(new LiveComment("cccccccc-3333-4ccc-8ccc-333333333333", session.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "msg-tiktok-3333", "77777777-7777-4777-8777-777777777777", "영희", "구매할게요", "2026-09-08T09:00:00.900Z", 3));
        comments.add(new LiveComment("cccccccc-2222-4ccc-8ccc-222222222222", session.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "msg-tiktok-2222", "66666666-6666-4666-8666-666666666666", "철수", "저요 123번", "2026-09-08T09:00:00.500Z", 2));
        comments.add(new LiveComment("cccccccc-1111-4ccc-8ccc-111111111111", session.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "msg-tiktok-1111", "66666666-6666-4666-8666-666666666666", "철수", "저요", "2026-09-08T09:00:00.100Z", 1));

        buyerStats.put("66666666-6666-4666-8666-666666666666", new BuyerStats("66666666-6666-4666-8666-666666666666", "철수", 2, 40000L, 5, 120000L));
        buyerStats.put("77777777-7777-4777-8777-777777777777", new BuyerStats("77777777-7777-4777-8777-777777777777", "영희", 0, 0L, 0, 0L));
    }

    @Override
    public void getBootstrap(Callback<BootstrapData> callback) {
        callback.onSuccess(new BootstrapData("11111111-1111-4111-8111-111111111111", settings, session, activeProduct, printerStatus, permissions));
    }

    @Override
    public void getSalesFeed(String sessionId, List<String> watchedBuyerIds, String sinceCursor, Callback<SalesFeedData> callback) {
        callback.onSuccess(new SalesFeedData(new ArrayList<>(comments), new HashMap<>(buyerStats), summary, activeProduct, session.revision, "cursor-comment-feed-seq-3", false));
    }

    @Override
    public void updateSettings(String operationId, int expectedRevision, Settings newSettings, Callback<Settings> callback) {
        if (expectedRevision != settings.revision) {
            callback.onError(new SalesError("REVISION_CONFLICT", "설정 버전 충돌이 발생했습니다.", false, null));
            return;
        }
        this.settings = new Settings(settings.revision + 1, newSettings.productRegistrationEnabled, newSettings.captureProductImageEnabled, newSettings.productNameInputEnabled, newSettings.voicePreviewMs);
        callback.onSuccess(this.settings);
    }

    @Override
    public void prepareProduct(String operationId, String sessionId, Integer expectedSessionRevision, String requestedProductCode, String name, Long unitPrice, String imageKind, Callback<PrepareProductResult> callback) {
        if (expectedSessionRevision != null && expectedSessionRevision != session.revision) {
            callback.onError(new SalesError("REVISION_CONFLICT", "회차 버전 충돌이 발생했습니다.", false, null));
            return;
        }
        String code = requestedProductCode != null && !requestedProductCode.trim().isEmpty() ? requestedProductCode.trim() : "P-20260908-" + (100000 + new Random().nextInt(900000));
        if ("ALREADY_USED".equals(code) || (activeProduct != null && code.equals(activeProduct.productCode))) {
            callback.onError(new SalesError("PRODUCT_CODE_EXISTS", "이미 사용 중이거나 예약된 상품번호입니다.", false, null));
            return;
        }

        String draftId = "55555555-dddd-4ddd-8ddd-555555555555";
        String productId = "55555555-5555-4555-8555-000000000007";
        drafts.put(draftId, new DraftData(draftId, 1, productId, code, name, unitPrice, imageKind != null ? imageKind : "PHOTO", "READY"));

        callback.onSuccess(new PrepareProductResult(
            draftId,
            1,
            productId,
            code,
            "https://storage.voicecap.local/upload/drafts/" + code + ".jpg",
            "2026-09-08T09:25:00.000Z"
        ));
    }

    @Override
    public void updateProductDraft(String operationId, String draftId, int expectedDraftRevision, String imageKind, boolean imageFallbackConfirmed, Callback<DraftData> callback) {
        DraftData draft = drafts.get(draftId);
        if (draft == null) {
            callback.onError(new SalesError("NOT_FOUND", "초안을 찾을 수 없습니다.", false, null));
            return;
        }
        if (draft.draftRevision != expectedDraftRevision) {
            callback.onError(new SalesError("REVISION_CONFLICT", "초안 버전 충돌이 발생했습니다.", false, null));
            return;
        }
        DraftData updated = new DraftData(draft.id, draft.draftRevision + 1, draft.productId, draft.productCode, draft.name, draft.unitPrice, imageKind, draft.status);
        drafts.put(draftId, updated);
        callback.onSuccess(updated);
    }

    @Override
    public void commitProduct(String operationId, String draftId, int expectedDraftRevision, int expectedSessionRevision, Callback<CommitProductResult> callback) {
        DraftData draft = drafts.get(draftId);
        if (draft == null) {
            callback.onError(new SalesError("NOT_FOUND", "초안을 찾을 수 없습니다.", false, null));
            return;
        }
        if (draft.draftRevision != expectedDraftRevision || session.revision != expectedSessionRevision) {
            callback.onError(new SalesError("REVISION_CONFLICT", "버전 충돌이 발생했습니다.", false, null));
            return;
        }

        String imgUrl = "NUMBER_IMAGE".equals(draft.imageKind)
            ? "https://storage.voicecap.local/products/number_image_" + draft.productCode + ".png"
            : "https://storage.voicecap.local/products/" + draft.productId + ".jpg";

        Product prod = new Product(draft.productId, draft.productCode, draft.name, draft.unitPrice, draft.imageKind, imgUrl, 1, 0);
        this.activeProduct = prod;
        this.session = new LiveSession(session.id, session.displayCode, session.status, prod.id, session.revision + 1, session.startedAt);

        callback.onSuccess(new CommitProductResult(prod, session));
    }

    @Override
    public void commitSales(String operationId, String sessionId, String productId, int expectedProductRevision, int expectedSessionRevision, List<CommitSaleBuyer> buyers, Callback<SalesResult> callback) {
        if (activeProduct == null || activeProduct.revision != expectedProductRevision || session.revision != expectedSessionRevision) {
            callback.onError(new SalesError("REVISION_CONFLICT", "다른 기기에서 상품 또는 회차가 변경되었습니다.", false, null));
            return;
        }

        int addedQty = 0;
        long addedAmt = 0;
        List<String> saleIds = new ArrayList<>();
        List<PrintJobInfo> printJobs = new ArrayList<>();

        for (CommitSaleBuyer b : buyers) {
            String sId = "sale-" + UUID.randomUUID().toString().substring(0, 8);
            saleIds.add(sId);
            addedQty += b.quantity;
            long saleAmt = b.quantity * (activeProduct.unitPrice != null ? activeProduct.unitPrice : 0);
            addedAmt += saleAmt;

            BuyerStats cur = buyerStats.get(b.buyerId);
            String nick = cur != null ? cur.displayNickname : "구매자";
            int newSeq = (cur != null ? cur.sessionQuantity : 0) + b.quantity;
            long newSamt = (cur != null ? cur.sessionAmount : 0) + saleAmt;
            int newTcnt = (cur != null ? cur.totalPurchaseCount : 0) + 1;
            long newTamt = (cur != null ? cur.totalPurchaseAmount : 0) + saleAmt;
            buyerStats.put(b.buyerId, new BuyerStats(b.buyerId, nick, newSeq, newSamt, newTcnt, newTamt));

            printJobs.add(new PrintJobInfo(UUID.randomUUID().toString(), "QUEUED", sId, nick, saleAmt));
        }

        summary = new SalesSummary(summary.sessionQuantity + addedQty, summary.sessionAmount + addedAmt);
        activeProduct = new Product(activeProduct.id, activeProduct.productCode, activeProduct.name, activeProduct.unitPrice, activeProduct.imageKind, activeProduct.imageUrl, activeProduct.revision, activeProduct.salesRevision + 1);

        callback.onSuccess(new SalesResult(saleIds, addedQty, addedAmt, summary, new HashMap<>(buyerStats), printJobs));
    }

    @Override
    public void getOperation(String operationId, Callback<Object> callback) {
        callback.onSuccess(new JSONObject());
    }

    @Override
    public void getPrintStatus(String sessionId, Callback<List<PrintJobInfo>> callback) {
        callback.onSuccess(Collections.emptyList());
    }

    @Override
    public void searchBuyers(String query, Callback<List<Buyer>> callback) {
        List<Buyer> list = new ArrayList<>();
        list.add(new Buyer("66666666-6666-4666-8666-666666666666", "TIKTOK", "tt-cheolsu-101", "철수", "VERIFIED"));
        list.add(new Buyer("88888888-8888-4888-8888-888888888888", "TIKTOK", "tt-cheolsu-999", "철수", "UNRESOLVED"));
        callback.onSuccess(list);
    }

    @Override
    public void confirmBuyer(String operationId, String displayNickname, String selectedBuyerId, String reason, Callback<Buyer> callback) {
        callback.onSuccess(new Buyer("66666666-7777-4666-8666-666666666666", "MANUAL", null, displayNickname, "MANUAL_CONFIRMED"));
    }
}
