const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'fixtures');
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

// 1. bootstrap.json
const bootstrapFixture = {
  ok: true,
  apiVersion: 1,
  serverTime: "2026-09-08T09:00:00.000Z",
  data: {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    settings: {
      revision: 1,
      productRegistrationEnabled: true,
      captureProductImageEnabled: true,
      productNameInputEnabled: true,
      voicePreviewMs: 2500,
      voiceCommands: {
        registerProduct: ["상품등록"],
        captureProduct: ["상품캡처"],
        setProductName: ["상품번호", "상품명"],
        setPrice: ["금액", "가격"],
        confirmSale: ["판매완료", "구매확정"],
        setBuyer: ["닉네임"]
      }
    },
    activeSession: {
      id: "33333333-3333-4333-8333-333333333333",
      displayCode: "2026-09-08 라이브 1회차",
      status: "ACTIVE",
      activeProductId: "55555555-5555-4555-8555-555555555555",
      revision: 8,
      startedAt: "2026-09-08T08:00:00.000Z"
    },
    activeProduct: {
      id: "55555555-5555-4555-8555-555555555555",
      productCode: "P-20260907-000123",
      name: "123번 니트",
      unitPrice: 20000,
      imageKind: "PHOTO",
      imageUrl: "https://storage.voicecap.local/products/p101.jpg",
      revision: 2,
      salesRevision: 0
    },
    printerStatus: {
      outputDeviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      outputDeviceName: "포스 프린터 메인 (POS-80)",
      online: true,
      queuedJobsCount: 0
    },
    permissions: [
      "SALES_READ",
      "SALES_WRITE",
      "PRODUCT_WRITE"
    ]
  }
};
fs.writeFileSync(path.join(baseDir, 'bootstrap.json'), JSON.stringify(bootstrapFixture, null, 2));

// 2. feed.json
const feedFixture = {
  normalFeedWithComments: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:01.000Z",
    data: {
      comments: [
        {
          id: "cccccccc-3333-4ccc-8ccc-333333333333",
          sessionId: "33333333-3333-4333-8333-333333333333",
          collectorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          platformMessageId: "msg-tiktok-3333",
          buyerId: "77777777-7777-4777-8777-777777777777",
          nicknameSnapshot: "영희",
          content: "구매할게요",
          capturedAt: "2026-09-08T09:00:00.900Z",
          ingestSequence: 3
        },
        {
          id: "cccccccc-2222-4ccc-8ccc-222222222222",
          sessionId: "33333333-3333-4333-8333-333333333333",
          collectorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          platformMessageId: "msg-tiktok-2222",
          buyerId: "66666666-6666-4666-8666-666666666666",
          nicknameSnapshot: "철수",
          content: "저요 123번",
          capturedAt: "2026-09-08T09:00:00.500Z",
          ingestSequence: 2
        },
        {
          id: "cccccccc-1111-4ccc-8ccc-111111111111",
          sessionId: "33333333-3333-4333-8333-333333333333",
          collectorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          platformMessageId: "msg-tiktok-1111",
          buyerId: "66666666-6666-4666-8666-666666666666",
          nicknameSnapshot: "철수",
          content: "저요",
          capturedAt: "2026-09-08T09:00:00.100Z",
          ingestSequence: 1
        }
      ],
      buyerStats: {
        "66666666-6666-4666-8666-666666666666": {
          buyerId: "66666666-6666-4666-8666-666666666666",
          displayNickname: "철수",
          sessionQuantity: 2,
          sessionAmount: 40000,
          totalPurchaseCount: 5,
          totalPurchaseAmount: 120000
        },
        "77777777-7777-4777-8777-777777777777": {
          buyerId: "77777777-7777-4777-8777-777777777777",
          displayNickname: "영희",
          sessionQuantity: 0,
          sessionAmount: 0,
          totalPurchaseCount: 0,
          totalPurchaseAmount: 0
        }
      },
      summary: {
        sessionQuantity: 2,
        sessionAmount: 40000
      },
      activeProduct: {
        id: "55555555-5555-4555-8555-555555555555",
        productCode: "P-20260907-000123",
        name: "123번 니트",
        unitPrice: 20000,
        imageKind: "PHOTO",
        imageUrl: "https://storage.voicecap.local/products/p101.jpg",
        revision: 2,
        salesRevision: 0
      },
      sessionRevision: 8,
      nextCursor: "cursor-comment-feed-seq-3",
      hasMore: false
    }
  },
  emptyCommentsWithWatchedBuyersStatsUpdate: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:05.000Z",
    data: {
      comments: [],
      buyerStats: {
        "66666666-6666-4666-8666-666666666666": {
          buyerId: "66666666-6666-4666-8666-666666666666",
          displayNickname: "철수",
          sessionQuantity: 4,
          sessionAmount: 80000,
          totalPurchaseCount: 6,
          totalPurchaseAmount: 160000
        },
        "77777777-7777-4777-8777-777777777777": {
          buyerId: "77777777-7777-4777-8777-777777777777",
          displayNickname: "영희",
          sessionQuantity: 1,
          sessionAmount: 20000,
          totalPurchaseCount: 1,
          totalPurchaseAmount: 20000
        }
      },
      summary: {
        sessionQuantity: 5,
        sessionAmount: 100000
      },
      activeProduct: {
        id: "55555555-5555-4555-8555-555555555555",
        productCode: "P-20260907-000123",
        name: "123번 니트",
        unitPrice: 20000,
        imageKind: "PHOTO",
        imageUrl: "https://storage.voicecap.local/products/p101.jpg",
        revision: 2,
        salesRevision: 1
      },
      sessionRevision: 8,
      nextCursor: "cursor-comment-feed-seq-3",
      hasMore: false
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'feed.json'), JSON.stringify(feedFixture, null, 2));

// 3. product_prepare_commit.json
const productPrepareCommitFixture = {
  prepareProductCode0007: {
    request: {
      action: "prepare-product",
      operationId: "eeeeeeee-1111-4eee-8eee-111111111111",
      sessionId: "33333333-3333-4333-8333-333333333333",
      expectedSessionRevision: 8,
      requestedProductCode: "0007",
      name: "0007 실크 스카프",
      unitPrice: 35000,
      imageKind: "PHOTO"
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:10:00.000Z",
      data: {
        draftId: "55555555-dddd-4ddd-8ddd-555555555555",
        draftRevision: 1,
        productId: "55555555-5555-4555-8555-000000000007",
        productCode: "0007",
        imageUpload: {
          uploadUrl: "https://storage.voicecap.local/upload/drafts/0007.jpg",
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          maxSizeBytes: 2097152
        },
        expiresAt: "2026-09-08T09:25:00.000Z"
      }
    }
  },
  updateProductDraftFallbackNumberImage: {
    request: {
      action: "update-product-draft",
      operationId: "eeeeeeee-1111-4eee-8eee-222222222222",
      draftId: "55555555-dddd-4ddd-8ddd-555555555555",
      expectedDraftRevision: 1,
      imageKind: "NUMBER_IMAGE",
      imageFallbackConfirmed: true
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:11:00.000Z",
      data: {
        draft: {
          id: "55555555-dddd-4ddd-8ddd-555555555555",
          draftRevision: 2,
          productId: "55555555-5555-4555-8555-000000000007",
          productCode: "0007",
          name: "0007 실크 스카프",
          unitPrice: 35000,
          imageKind: "NUMBER_IMAGE",
          status: "READY"
        }
      }
    }
  },
  commitProduct: {
    request: {
      action: "commit-product",
      operationId: "eeeeeeee-1111-4eee-8eee-333333333333",
      draftId: "55555555-dddd-4ddd-8ddd-555555555555",
      expectedDraftRevision: 2,
      expectedSessionRevision: 8
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:12:00.000Z",
      data: {
        product: {
          id: "55555555-5555-4555-8555-000000000007",
          productCode: "0007",
          name: "0007 실크 스카프",
          unitPrice: 35000,
          imageKind: "NUMBER_IMAGE",
          imageUrl: "https://storage.voicecap.local/products/number_image_0007.png",
          revision: 1,
          salesRevision: 0
        },
        session: {
          id: "33333333-3333-4333-8333-333333333333",
          activeProductId: "55555555-5555-4555-8555-000000000007",
          revision: 9
        }
      }
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'product_prepare_commit.json'), JSON.stringify(productPrepareCommitFixture, null, 2));

// 4. commit_sales.json
const commitSalesFixture = {
  request: {
    action: "commit-sales",
    operationId: "eeeeeeee-2222-4eee-8eee-111111111111",
    sessionId: "33333333-3333-4333-8333-333333333333",
    productId: "55555555-5555-4555-8555-555555555555",
    expectedProductRevision: 2,
    expectedSessionRevision: 8,
    buyers: [
      {
        buyerId: "66666666-6666-4666-8666-666666666666",
        quantity: 2,
        sourceCommentIds: [
          "cccccccc-1111-4ccc-8ccc-111111111111",
          "cccccccc-2222-4ccc-8ccc-222222222222"
        ]
      },
      {
        buyerId: "77777777-7777-4777-8777-777777777777",
        quantity: 1,
        sourceCommentIds: [
          "cccccccc-3333-4ccc-8ccc-333333333333"
        ]
      }
    ]
  },
  response: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:03.000Z",
    data: {
      operationId: "eeeeeeee-2222-4eee-8eee-111111111111",
      status: "SUCCEEDED",
      sales: [
        {
          id: "sale-101-cheolsu",
          productId: "55555555-5555-4555-8555-555555555555",
          buyerId: "66666666-6666-4666-8666-666666666666",
          buyerNickname: "철수",
          quantity: 2,
          unitPrice: 20000,
          amount: 40000,
          revision: 1,
          recordState: "ACTIVE",
          productCodeSnapshot: "P-20260907-000123",
          productNameSnapshot: "123번 니트",
          productImagePathSnapshot: "products/p101.jpg"
        },
        {
          id: "sale-101-yeonghui",
          productId: "55555555-5555-4555-8555-555555555555",
          buyerId: "77777777-7777-4777-8777-777777777777",
          buyerNickname: "영희",
          quantity: 1,
          unitPrice: 20000,
          amount: 20000,
          revision: 1,
          recordState: "ACTIVE",
          productCodeSnapshot: "P-20260907-000123",
          productNameSnapshot: "123번 니트",
          productImagePathSnapshot: "products/p101.jpg"
        }
      ],
      summary: {
        sessionQuantity: 5,
        sessionAmount: 100000
      },
      buyerStats: {
        "66666666-6666-4666-8666-666666666666": {
          buyerId: "66666666-6666-4666-8666-666666666666",
          displayNickname: "철수",
          sessionQuantity: 4,
          sessionAmount: 80000,
          totalPurchaseCount: 6,
          totalPurchaseAmount: 160000
        },
        "77777777-7777-4777-8777-777777777777": {
          buyerId: "77777777-7777-4777-8777-777777777777",
          displayNickname: "영희",
          sessionQuantity: 1,
          sessionAmount: 20000,
          totalPurchaseCount: 1,
          totalPurchaseAmount: 20000
        }
      },
      printJobs: [
        {
          id: "dddddddd-1111-4ddd-8ddd-111111111111",
          saleId: "sale-101-cheolsu",
          saleRevision: 1,
          kind: "SALE",
          status: "QUEUED"
        },
        {
          id: "dddddddd-2222-4ddd-8ddd-222222222222",
          saleId: "sale-101-yeonghui",
          saleRevision: 1,
          kind: "SALE",
          status: "QUEUED"
        }
      ]
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'commit_sales.json'), JSON.stringify(commitSalesFixture, null, 2));

// 5. product_change.json
const productChangeFixture = {
  prepareProductImage: {
    request: {
      action: "prepare-product-image",
      operationId: "eeeeeeee-3333-4eee-8eee-111111111111",
      productId: "55555555-5555-4555-8555-555555555555",
      expectedProductRevision: 2,
      fileName: "knit_updated.jpg",
      mimeType: "image/jpeg",
      size: 154320
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:20:00.000Z",
      data: {
        imageId: "img-change-5555-1111",
        imageUpload: {
          uploadUrl: "https://storage.voicecap.local/upload/products/knit_updated.jpg",
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          maxSizeBytes: 2097152
        },
        expiresAt: "2026-09-08T09:35:00.000Z"
      }
    }
  },
  previewProductChange: {
    request: {
      action: "preview-product-change",
      productId: "55555555-5555-4555-8555-555555555555",
      expectedProductRevision: 2,
      expectedSalesRevision: 1,
      proposedProduct: {
        unitPrice: 25000
      },
      proposedSales: [
        {
          saleId: "sale-101-cheolsu",
          expectedRevision: 1,
          quantity: 2
        },
        {
          saleId: "sale-101-yeonghui",
          expectedRevision: 1,
          quantity: 1
        }
      ]
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:20:05.000Z",
      data: {
        previewToken: "prevtok_0123456789abcdef0123456789abcdef",
        expiresAt: "2026-09-08T09:22:05.000Z",
        before: {
          unitPrice: 20000,
          salesQuantity: 3,
          salesAmount: 60000,
          sessionQuantity: 5,
          sessionAmount: 100000
        },
        after: {
          unitPrice: 25000,
          salesQuantity: 3,
          salesAmount: 75000,
          sessionQuantity: 5,
          sessionAmount: 115000
        },
        diffAmount: 15000,
        affectedBuyers: [
          {
            buyerId: "66666666-6666-4666-8666-666666666666",
            displayNickname: "철수",
            quantity: 2,
            oldUnitPrice: 20000,
            newUnitPrice: 25000,
            oldAmount: 40000,
            newAmount: 50000,
            diffAmount: 10000,
            newTotalPurchaseCount: 6,
            newTotalPurchaseAmount: 170000
          },
          {
            buyerId: "77777777-7777-4777-8777-777777777777",
            displayNickname: "영희",
            quantity: 1,
            oldUnitPrice: 20000,
            newUnitPrice: 25000,
            oldAmount: 20000,
            newAmount: 25000,
            diffAmount: 5000,
            newTotalPurchaseCount: 1,
            newTotalPurchaseAmount: 25000
          }
        ],
        settlements: {
          affectedSettlementsCount: 0,
          requiresManualReview: false
        }
      }
    }
  },
  commitProductChange: {
    request: {
      action: "commit-product-change",
      operationId: "eeeeeeee-3333-4eee-8eee-222222222222",
      previewToken: "prevtok_0123456789abcdef0123456789abcdef"
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:20:10.000Z",
      data: {
        product: {
          id: "55555555-5555-4555-8555-555555555555",
          productCode: "P-20260907-000123",
          name: "123번 니트",
          unitPrice: 25000,
          imageKind: "PHOTO",
          imageUrl: "https://storage.voicecap.local/products/p101.jpg",
          revision: 3,
          salesRevision: 2
        },
        sales: [
          {
            id: "sale-101-cheolsu",
            buyerId: "66666666-6666-4666-8666-666666666666",
            buyerNickname: "철수",
            quantity: 2,
            unitPrice: 25000,
            amount: 50000,
            revision: 2,
            recordState: "ACTIVE"
          },
          {
            id: "sale-101-yeonghui",
            buyerId: "77777777-7777-4777-8777-777777777777",
            buyerNickname: "영희",
            quantity: 1,
            unitPrice: 25000,
            amount: 25000,
            revision: 2,
            recordState: "ACTIVE"
          }
        ],
        summary: {
          sessionQuantity: 5,
          sessionAmount: 115000
        },
        buyerStats: {
          "66666666-6666-4666-8666-666666666666": {
            buyerId: "66666666-6666-4666-8666-666666666666",
            displayNickname: "철수",
            sessionQuantity: 4,
            sessionAmount: 90000,
            totalPurchaseCount: 6,
            totalPurchaseAmount: 170000
          },
          "77777777-7777-4777-8777-777777777777": {
            buyerId: "77777777-7777-4777-8777-777777777777",
            displayNickname: "영희",
            sessionQuantity: 1,
            sessionAmount: 25000,
            totalPurchaseCount: 1,
            totalPurchaseAmount: 25000
          }
        },
        printJobs: [
          {
            id: "dddddddd-3333-4ddd-8ddd-333333333333",
            saleId: "sale-101-cheolsu",
            saleRevision: 2,
            kind: "CORRECTION",
            status: "QUEUED"
          },
          {
            id: "dddddddd-4444-4ddd-8ddd-444444444444",
            saleId: "sale-101-yeonghui",
            saleRevision: 2,
            kind: "CORRECTION",
            status: "QUEUED"
          }
        ]
      }
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'product_change.json'), JSON.stringify(productChangeFixture, null, 2));

// 6. print_workflow.json
const printWorkflowFixture = {
  claimPrintJobs: {
    request: {
      action: "claim-print-jobs",
      limit: 10
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:21:00.000Z",
      data: {
        jobs: [
          {
            id: "dddddddd-1111-4ddd-8ddd-111111111111",
            saleId: "sale-101-cheolsu",
            saleRevision: 1,
            kind: "SALE",
            status: "CLAIMED",
            immutablePayload: {
              sessionCode: "2026-09-08 라이브 1회차",
              productCode: "P-20260907-000123",
              productName: "123번 니트",
              buyerNickname: "철수",
              quantity: 2,
              unitPrice: 20000,
              amount: 40000,
              createdAt: "2026-09-08T09:00:03.000Z",
              kind: "SALE"
            },
            attempts: 1
          }
        ],
        leaseToken: "lease_tok_1111222233334444",
        leaseExpiresAt: "2026-09-08T09:21:30.000Z"
      }
    }
  },
  renewPrintLease: {
    request: {
      action: "renew-print-lease",
      jobId: "dddddddd-1111-4ddd-8ddd-111111111111",
      leaseToken: "lease_tok_1111222233334444"
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:21:10.000Z",
      data: {
        leaseExpiresAt: "2026-09-08T09:21:40.000Z"
      }
    }
  },
  beginPrintJobSubmitting: {
    request: {
      action: "begin-print-job",
      jobId: "dddddddd-1111-4ddd-8ddd-111111111111",
      leaseToken: "lease_tok_1111222233334444",
      payloadHash: "hash_payload_11112222",
      expectedSaleRevision: 1
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:21:15.000Z",
      data: {
        status: "SUBMITTING",
        serverRecordedAt: "2026-09-08T09:21:15.000Z"
      }
    }
  },
  acknowledgePrintJobSubmitted: {
    request: {
      action: "acknowledge-print-job",
      jobId: "dddddddd-1111-4ddd-8ddd-111111111111",
      leaseToken: "lease_tok_1111222233334444",
      result: "SUCCESS",
      spoolJobId: 1042
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:21:16.000Z",
      data: {
        status: "SUBMITTED",
        job: {
          id: "dddddddd-1111-4ddd-8ddd-111111111111",
          status: "SUBMITTED",
          spoolJobId: 1042
        }
      }
    }
  },
  unknownPrintJobStatus: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:22:00.000Z",
    data: {
      jobs: [
        {
          id: "dddddddd-1111-4ddd-8ddd-111111111111",
          saleId: "sale-101-cheolsu",
          status: "UNKNOWN",
          message: "인쇄 시스템 접수 상태가 불명확하여 수동 확인이 필요합니다.",
          requiresManualReview: true
        }
      ]
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'print_workflow.json'), JSON.stringify(printWorkflowFixture, null, 2));

// 7. device_management.json
const deviceManagementFixture = {
  listDevices: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    data: {
      devices: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          displayName: "갤럭시 S24 (판매관리 단말)",
          deviceType: "ANDROID_PHONE",
          capabilities: ["SALES_READ", "SALES_WRITE", "PRODUCT_WRITE"],
          isOutputDevice: false,
          revision: 3,
          lastSeenAt: "2026-09-08T08:59:00.000Z"
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          displayName: "메인 PC 프린터 (POS-80)",
          deviceType: "WINDOWS_HELPER",
          capabilities: ["PRINT", "COMMENT_INGEST"],
          isOutputDevice: true,
          revision: 5,
          lastSeenAt: "2026-09-08T08:59:30.000Z"
        }
      ],
      nextCursor: null
    }
  },
  updateDeviceCapabilities: {
    request: {
      action: "update-device-capabilities",
      operationId: "eeeeeeee-4444-4eee-8eee-111111111111",
      deviceId: "99999999-9999-4999-8999-999999999999",
      expectedDeviceRevision: 3,
      capabilities: ["SALES_READ", "SALES_WRITE", "PRODUCT_WRITE"]
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:00:10.000Z",
      data: {
        device: {
          id: "99999999-9999-4999-8999-999999999999",
          displayName: "갤럭시 S24 (판매관리 단말)",
          capabilities: ["SALES_READ", "SALES_WRITE", "PRODUCT_WRITE"],
          revision: 4
        },
        auditLogId: "audit-log-uuid-9999"
      }
    }
  },
  setOutputDevice: {
    request: {
      action: "set-output-device",
      operationId: "eeeeeeee-4444-4eee-8eee-222222222222",
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedSettingsRevision: 1
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:00:15.000Z",
      data: {
        outputDevice: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          displayName: "메인 PC 프린터 (POS-80)"
        },
        settingsRevision: 2
      }
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'device_management.json'), JSON.stringify(deviceManagementFixture, null, 2));

// 8. buyers.json
const buyersFixture = {
  searchBuyers: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    data: {
      buyers: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          platform: "TIKTOK",
          platformUserId: "tt-cheolsu-101",
          displayNickname: "철수",
          identityStatus: "VERIFIED",
          stats: {
            sessionQuantity: 2,
            sessionAmount: 40000,
            totalPurchaseCount: 5,
            totalPurchaseAmount: 120000
          }
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          platform: "TIKTOK",
          platformUserId: "tt-cheolsu-999",
          displayNickname: "철수",
          identityStatus: "UNRESOLVED",
          stats: {
            sessionQuantity: 0,
            sessionAmount: 0,
            totalPurchaseCount: 0,
            totalPurchaseAmount: 0
          }
        }
      ],
      nextCursor: null
    }
  },
  confirmBuyerManual: {
    request: {
      action: "confirm-buyer",
      operationId: "eeeeeeee-5555-4eee-8eee-111111111111",
      displayNickname: "철수삼촌",
      confirmationReason: "판매자가 라이브 방송 중 신원을 구두 확인하고 수동 생성"
    },
    response: {
      ok: true,
      apiVersion: 1,
      serverTime: "2026-09-08T09:05:00.000Z",
      data: {
        buyer: {
          id: "66666666-7777-4666-8666-666666666666",
          platform: "MANUAL",
          displayNickname: "철수삼촌",
          identityStatus: "MANUAL_CONFIRMED"
        }
      }
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'buyers.json'), JSON.stringify(buyersFixture, null, 2));

// 9. operations.json
const operationsFixture = {
  notFound: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "NOT_FOUND",
      message: "해당 operationId가 서버에 접수되지 않았습니다. 원본 요청 본문으로 재전송하십시오.",
      retryable: true,
      details: { operationId: "eeeeeeee-9999-4eee-8eee-999999999999" }
    }
  },
  processing: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:01.000Z",
    data: {
      operationId: "eeeeeeee-2222-4eee-8eee-111111111111",
      status: "PROCESSING"
    }
  },
  succeeded: {
    ok: true,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:03.000Z",
    data: {
      operationId: "eeeeeeee-2222-4eee-8eee-111111111111",
      status: "SUCCEEDED",
      result: {
        salesCount: 2,
        sessionQuantity: 5,
        sessionAmount: 100000
      }
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'operations.json'), JSON.stringify(operationsFixture, null, 2));

// 10. errors.json
const errorsFixture = {
  revisionConflict: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "REVISION_CONFLICT",
      message: "다른 기기에서 상품 또는 회차가 변경되었습니다. 최신 내용을 확인해 주세요.",
      retryable: false,
      details: {
        currentProductRevision: 3,
        currentSessionRevision: 9
      }
    }
  },
  capabilityDenied: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "CAPABILITY_DENIED",
      message: "이 기기는 판매관리 권한(SALES_WRITE)이 없습니다. 웹 관리자에게 권한을 요청하세요.",
      retryable: false,
      details: {
        requiredCapability: "SALES_WRITE"
      }
    }
  },
  productCodeExists: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "PRODUCT_CODE_EXISTS",
      message: "이미 사용 중이거나 예약된 상품번호입니다. 다른 번호를 입력해 주세요.",
      retryable: false,
      details: {
        productCode: "0007"
      }
    }
  },
  operationPayloadMismatch: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "OPERATION_PAYLOAD_MISMATCH",
      message: "동일한 operationId로 내용이 다른 요청이 전송되었습니다.",
      retryable: false,
      details: {
        operationId: "eeeeeeee-2222-4eee-8eee-111111111111"
      }
    }
  },
  commentAlreadyCommitted: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "COMMENT_ALREADY_COMMITTED",
      message: "이미 해당 상품의 판매로 등록된 댓글입니다.",
      retryable: false,
      details: {
        commentId: "cccccccc-1111-4ccc-8ccc-111111111111",
        existingSaleId: "sale-101-cheolsu"
      }
    }
  },
  previewExpired: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "PREVIEW_EXPIRED",
      message: "수정 미리보기 시간이 만료되었습니다. 다시 변경 내용을 확인해 주세요.",
      retryable: false,
      details: {
        previewToken: "prevtok_0123456789abcdef0123456789abcdef"
      }
    }
  },
  validationErrorPriceRequired: {
    ok: false,
    apiVersion: 1,
    serverTime: "2026-09-08T09:00:00.000Z",
    error: {
      code: "PRICE_REQUIRED",
      message: "판매 단가를 입력해 주세요. 가격 없는 상품은 판매를 완료할 수 없습니다.",
      retryable: false,
      details: {
        field: "unitPrice"
      }
    }
  }
};
fs.writeFileSync(path.join(baseDir, 'errors.json'), JSON.stringify(errorsFixture, null, 2));

console.log("Successfully generated all fixtures in", baseDir);
