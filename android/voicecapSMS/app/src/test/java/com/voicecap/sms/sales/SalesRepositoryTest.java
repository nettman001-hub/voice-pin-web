package com.voicecap.sms.sales;

import com.voicecap.sms.sales.model.SalesModels.*;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class SalesRepositoryTest {

    @Test
    public void testFakeRepositoryBootstrap() {
        FakeSalesRepository repo = new FakeSalesRepository();
        repo.getBootstrap(new SalesRepository.Callback<BootstrapData>() {
            @Override
            public void onSuccess(BootstrapData result) {
                assertNotNull(result);
                assertEquals("11111111-1111-4111-8111-111111111111", result.workspaceId);
                assertNotNull(result.activeProduct);
                assertEquals("P-20260907-000123", result.activeProduct.productCode);
                assertEquals(Long.valueOf(20000L), result.activeProduct.unitPrice);
                assertNotNull(result.activeSession);
                assertEquals(8, result.activeSession.revision);
                assertTrue(result.permissions.contains("SALES_WRITE"));
            }

            @Override
            public void onError(SalesError error) {
                fail("Should not fail: " + error.getMessage());
            }
        });
    }

    @Test
    public void testPrepareProductPreservesLeadingZeros0007() {
        FakeSalesRepository repo = new FakeSalesRepository();
        repo.prepareProduct("op-1", "33333333-3333-4333-8333-333333333333", 8, "0007", "0007 실크 스카프", 35000L, "PHOTO", new SalesRepository.Callback<PrepareProductResult>() {
            @Override
            public void onSuccess(PrepareProductResult result) {
                assertNotNull(result);
                assertEquals("0007", result.productCode);
                assertEquals("55555555-dddd-4ddd-8ddd-555555555555", result.draftId);
            }

            @Override
            public void onError(SalesError error) {
                fail("Should not fail: " + error.getMessage());
            }
        });
    }

    @Test
    public void testPrepareProductDuplicateRejection() {
        FakeSalesRepository repo = new FakeSalesRepository();
        repo.prepareProduct("op-2", "33333333-3333-4333-8333-333333333333", 8, "P-20260907-000123", "중복", 10000L, "PHOTO", new SalesRepository.Callback<PrepareProductResult>() {
            @Override
            public void onSuccess(PrepareProductResult result) {
                fail("Expected PRODUCT_CODE_EXISTS error");
            }

            @Override
            public void onError(SalesError error) {
                assertEquals("PRODUCT_CODE_EXISTS", error.code);
            }
        });
    }

    @Test
    public void testDraftFallbackAndCommit() {
        FakeSalesRepository repo = new FakeSalesRepository();
        // 1. Prepare
        repo.prepareProduct("op-prep", "33333333-3333-4333-8333-333333333333", 8, "0007", "스카프", 35000L, "PHOTO", new SalesRepository.Callback<PrepareProductResult>() {
            @Override
            public void onSuccess(PrepareProductResult prepResult) {
                // 2. Fallback to NUMBER_IMAGE
                repo.updateProductDraft("op-up", prepResult.draftId, 1, "NUMBER_IMAGE", true, new SalesRepository.Callback<DraftData>() {
                    @Override
                    public void onSuccess(DraftData draftResult) {
                        assertEquals("NUMBER_IMAGE", draftResult.imageKind);
                        assertEquals(2, draftResult.draftRevision);

                        // 3. Commit
                        repo.commitProduct("op-comm", draftResult.id, 2, 8, new SalesRepository.Callback<CommitProductResult>() {
                            @Override
                            public void onSuccess(CommitProductResult commitResult) {
                                assertEquals("0007", commitResult.product.productCode);
                                assertEquals(9, commitResult.session.revision);
                            }

                            @Override
                            public void onError(SalesError error) {
                                fail("Commit error: " + error.getMessage());
                            }
                        });
                    }

                    @Override
                    public void onError(SalesError error) {
                        fail("Update error: " + error.getMessage());
                    }
                });
            }

            @Override
            public void onError(SalesError error) {
                fail("Prepare error: " + error.getMessage());
            }
        });
    }

    @Test
    public void testCommitSalesCalculationAndStats() {
        FakeSalesRepository repo = new FakeSalesRepository();
        List<CommitSaleBuyer> buyers = Collections.singletonList(
            new CommitSaleBuyer("66666666-6666-4666-8666-666666666666", 2, Arrays.asList("c-1", "c-2"))
        );

        repo.commitSales("op-sale-1", "33333333-3333-4333-8333-333333333333", "55555555-5555-4555-8555-555555555555", 2, 8, buyers, new SalesRepository.Callback<SalesResult>() {
            @Override
            public void onSuccess(SalesResult result) {
                assertNotNull(result);
                assertEquals(1, result.saleIds.size());
                assertEquals(2, result.totalQuantity);
                assertEquals(40000L, result.totalAmount); // 2 * 20000
                assertEquals(4, result.summary.sessionQuantity); // 2 initial + 2 new
                assertEquals(80000L, result.summary.sessionAmount); // 40000 + 40000
                assertEquals(1, result.printJobs.size());
                assertEquals("QUEUED", result.printJobs.get(0).status);
            }

            @Override
            public void onError(SalesError error) {
                fail("Commit sales error: " + error.getMessage());
            }
        });
    }
}
