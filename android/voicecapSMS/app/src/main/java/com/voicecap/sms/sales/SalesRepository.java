package com.voicecap.sms.sales;

import com.voicecap.sms.sales.model.SalesModels.*;
import java.util.List;

public interface SalesRepository {
    interface Callback<T> {
        void onSuccess(T result);
        void onError(SalesError error);
    }

    void getBootstrap(Callback<BootstrapData> callback);
    void getSalesFeed(String sessionId, List<String> watchedBuyerIds, String sinceCursor, Callback<SalesFeedData> callback);
    void updateSettings(String operationId, int expectedRevision, Settings settings, Callback<Settings> callback);
    void prepareProduct(String operationId, String sessionId, Integer expectedSessionRevision, String requestedProductCode, String name, Long unitPrice, String imageKind, Callback<PrepareProductResult> callback);
    void updateProductDraft(String operationId, String draftId, int expectedDraftRevision, String imageKind, boolean imageFallbackConfirmed, Callback<DraftData> callback);
    void commitProduct(String operationId, String draftId, int expectedDraftRevision, int expectedSessionRevision, Callback<CommitProductResult> callback);
    void commitSales(String operationId, String sessionId, String productId, int expectedProductRevision, int expectedSessionRevision, List<CommitSaleBuyer> buyers, Callback<SalesResult> callback);
    void getOperation(String operationId, Callback<Object> callback);
    void getPrintStatus(String sessionId, Callback<List<PrintJobInfo>> callback);
    void searchBuyers(String query, Callback<List<Buyer>> callback);
    void confirmBuyer(String operationId, String displayNickname, String selectedBuyerId, String reason, Callback<Buyer> callback);
    void listSessionProducts(String sessionId, Callback<List<Product>> callback);
    void getProductSales(String sessionId, String productId, Callback<List<ProductSale>> callback);
    void previewProductChange(String productId, int expectedProductRevision, int expectedSalesRevision, Long proposedUnitPrice, List<ProposedSale> proposedSales, Callback<PreviewChangeResult> callback);
    void commitProductChange(String operationId, String previewToken, Callback<CommitProductChangeResult> callback);
}
