package com.voicecap.sms.sales.ui;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.model.SalesModels.*;

import java.text.NumberFormat;
import java.util.*;

public final class ProductChangeDialog {
    private ProductChangeDialog() {}

    private static final class EditableSale {
        final String saleId; // null if newly added
        final Integer expectedRevision;
        final String buyerId;
        final String buyerNickname;
        int quantity;
        final long originalUnitPrice;
        final long originalAmount;
        boolean cancelled;

        EditableSale(String saleId, Integer expectedRevision, String buyerId, String buyerNickname, int quantity, long originalUnitPrice, long originalAmount, boolean cancelled) {
            this.saleId = saleId;
            this.expectedRevision = expectedRevision;
            this.buyerId = buyerId;
            this.buyerNickname = buyerNickname;
            this.quantity = quantity;
            this.originalUnitPrice = originalUnitPrice;
            this.originalAmount = originalAmount;
            this.cancelled = cancelled;
        }
    }

    public static void show(
        Context context,
        SalesRepository repository,
        LiveSession activeSession,
        Product activeProduct,
        Runnable onProductChanged
    ) {
        if (activeSession == null) {
            Toast.makeText(context, "활성 회차가 없습니다.", Toast.LENGTH_SHORT).show();
            return;
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle("상품별 판매내역 및 수정");

        ScrollView scrollView = new ScrollView(context);
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * context.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);
        scrollView.addView(layout);

        // 1. Session Products Spinner / Selector
        TextView lblSelectProd = new TextView(context);
        lblSelectProd.setText("수정할 상품 선택");
        lblSelectProd.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        layout.addView(lblSelectProd);

        Spinner spProducts = new Spinner(context);
        layout.addView(spProducts);

        // 2. Product Info Section
        LinearLayout prodInfoCard = new LinearLayout(context);
        prodInfoCard.setOrientation(LinearLayout.VERTICAL);
        prodInfoCard.setPadding(pad, pad, pad, pad);
        prodInfoCard.setBackground(roundRect(context, Color.WHITE, Color.rgb(226, 232, 240), 8));
        LinearLayout.LayoutParams piParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        piParams.topMargin = pad / 2;
        prodInfoCard.setLayoutParams(piParams);

        TextView tvProdCode = new TextView(context);
        tvProdCode.setText("상품코드: -");
        tvProdCode.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        tvProdCode.setTextColor(Color.rgb(30, 41, 59));
        prodInfoCard.addView(tvProdCode);

        TextView lblProdName = new TextView(context);
        lblProdName.setText("상품명");
        lblProdName.setTextSize(12);
        lblProdName.setTextColor(Color.rgb(100, 116, 139));
        lblProdName.setPadding(0, pad / 2, 0, 0);
        prodInfoCard.addView(lblProdName);

        EditText etProdName = new EditText(context);
        etProdName.setSingleLine(true);
        prodInfoCard.addView(etProdName);

        TextView lblProdPrice = new TextView(context);
        lblProdPrice.setText("판매단가 (원) - 변경 시 기존 활성 판매 전체 소급 적용");
        lblProdPrice.setTextSize(12);
        lblProdPrice.setTextColor(Color.rgb(225, 29, 72));
        lblProdPrice.setPadding(0, pad / 4, 0, 0);
        prodInfoCard.addView(lblProdPrice);

        EditText etProdPrice = new EditText(context);
        etProdPrice.setInputType(InputType.TYPE_CLASS_NUMBER);
        etProdPrice.setSingleLine(true);
        prodInfoCard.addView(etProdPrice);

        layout.addView(prodInfoCard);

        // 3. Sales List Header
        LinearLayout salesHeader = new LinearLayout(context);
        salesHeader.setOrientation(LinearLayout.HORIZONTAL);
        salesHeader.setGravity(Gravity.CENTER_VERTICAL);
        salesHeader.setPadding(0, pad, 0, pad / 4);

        TextView lblSales = new TextView(context);
        lblSales.setText("구매자 목록");
        lblSales.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams shParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lblSales.setLayoutParams(shParams);
        salesHeader.addView(lblSales);

        Button btnAddBuyer = new Button(context);
        btnAddBuyer.setText("+ 구매자 추가");
        btnAddBuyer.setTextSize(12);
        salesHeader.addView(btnAddBuyer);
        layout.addView(salesHeader);

        // 4. Sales List Container
        LinearLayout salesContainer = new LinearLayout(context);
        salesContainer.setOrientation(LinearLayout.VERTICAL);
        layout.addView(salesContainer);

        // 5. Preview Results Container
        LinearLayout previewCard = new LinearLayout(context);
        previewCard.setOrientation(LinearLayout.VERTICAL);
        previewCard.setPadding(pad, pad, pad, pad);
        previewCard.setBackground(roundRect(context, Color.rgb(241, 245, 249), Color.rgb(203, 213, 225), 8));
        LinearLayout.LayoutParams prParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        prParams.topMargin = pad;
        previewCard.setLayoutParams(prParams);
        previewCard.setVisibility(View.GONE);
        layout.addView(previewCard);

        // Action Buttons
        LinearLayout btnRow = new LinearLayout(context);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setPadding(0, pad, 0, 0);

        Button btnPreview = new Button(context);
        btnPreview.setText("변경 미리보기");
        LinearLayout.LayoutParams bpParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bpParams.rightMargin = pad / 4;
        btnPreview.setLayoutParams(bpParams);
        btnRow.addView(btnPreview);

        Button btnCommit = new Button(context);
        btnCommit.setText("변경 적용");
        btnCommit.setEnabled(false);
        LinearLayout.LayoutParams bcParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bcParams.leftMargin = pad / 4;
        btnCommit.setLayoutParams(bcParams);
        btnRow.addView(btnCommit);

        layout.addView(btnRow);

        builder.setView(scrollView);
        builder.setNegativeButton("닫기", (dialog, which) -> dialog.dismiss());

        AlertDialog dialog = builder.create();
        dialog.show();

        // State holder
        final List<Product> sessionProducts = new ArrayList<>();
        final List<EditableSale> editableSales = new ArrayList<>();
        final String[] currentPreviewToken = new String[]{null};
        final Product[] currentProduct = new Product[]{null};

        // Render sales helper
        final Runnable[] renderSalesRef = new Runnable[1];
        renderSalesRef[0] = () -> {
            salesContainer.removeAllViews();
            if (editableSales.isEmpty()) {
                TextView empty = new TextView(context);
                empty.setText("해당 상품에 등록된 구매자가 없습니다.");
                empty.setTextColor(Color.rgb(148, 163, 184));
                empty.setPadding(0, pad / 2, 0, pad / 2);
                salesContainer.addView(empty);
                return;
            }

            for (EditableSale s : editableSales) {
                LinearLayout row = new LinearLayout(context);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(Gravity.CENTER_VERTICAL);
                row.setPadding(pad / 2, pad / 2, pad / 2, pad / 2);
                row.setBackground(roundRect(context, s.cancelled ? Color.rgb(254, 242, 242) : Color.WHITE, Color.rgb(226, 232, 240), 6));
                LinearLayout.LayoutParams rParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                rParams.bottomMargin = pad / 4;
                row.setLayoutParams(rParams);

                LinearLayout infoCol = new LinearLayout(context);
                infoCol.setOrientation(LinearLayout.VERTICAL);
                LinearLayout.LayoutParams icParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                infoCol.setLayoutParams(icParams);

                TextView tvName = new TextView(context);
                tvName.setText(s.buyerNickname + (s.saleId == null ? " [신규]" : ""));
                tvName.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                tvName.setTextColor(s.cancelled ? Color.rgb(156, 163, 175) : Color.rgb(30, 41, 59));
                infoCol.addView(tvName);

                TextView tvSub = new TextView(context);
                String amtStr = NumberFormat.getNumberInstance(Locale.KOREA).format(s.originalAmount);
                tvSub.setText(s.cancelled ? "[취소됨]" : "수량: " + s.quantity + "개 · 기존: ₩" + amtStr);
                tvSub.setTextSize(11);
                tvSub.setTextColor(s.cancelled ? Color.RED : Color.rgb(100, 116, 139));
                infoCol.addView(tvSub);
                row.addView(infoCol);

                if (!s.cancelled) {
                    Button minus = new Button(context);
                    minus.setText("-");
                    minus.setLayoutParams(new LinearLayout.LayoutParams(dp(context, 36), dp(context, 36)));
                    minus.setOnClickListener(v -> {
                        if (s.quantity > 1) {
                            s.quantity--;
                            btnCommit.setEnabled(false);
                            currentPreviewToken[0] = null;
                            // Re-render
                            salesContainer.post(renderSalesRef[0]);
                        }
                    });
                    row.addView(minus);

                    TextView tvQ = new TextView(context);
                    tvQ.setText(String.valueOf(s.quantity));
                    tvQ.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                    tvQ.setPadding(dp(context, 6), 0, dp(context, 6), 0);
                    row.addView(tvQ);

                    Button plus = new Button(context);
                    plus.setText("+");
                    plus.setLayoutParams(new LinearLayout.LayoutParams(dp(context, 36), dp(context, 36)));
                    plus.setOnClickListener(v -> {
                        s.quantity++;
                        btnCommit.setEnabled(false);
                        currentPreviewToken[0] = null;
                        // Re-render
                        salesContainer.post(renderSalesRef[0]);
                    });
                    row.addView(plus);
                }

                Button btnCancel = new Button(context);
                btnCancel.setText(s.cancelled ? "복구" : "제외");
                btnCancel.setTextSize(11);
                btnCancel.setOnClickListener(v -> {
                    s.cancelled = !s.cancelled;
                    btnCommit.setEnabled(false);
                    currentPreviewToken[0] = null;
                    salesContainer.post(renderSalesRef[0]);
                });
                row.addView(btnCancel);

                salesContainer.addView(row);
            }
        };

        // Load Sales for Selected Product
        Runnable loadSalesForSelectedProduct = () -> {
            if (currentProduct[0] == null) return;
            Product p = currentProduct[0];
            tvProdCode.setText("상품코드: " + p.productCode + " (rev: " + p.revision + ", salesRev: " + p.salesRevision + ")");
            etProdName.setText(p.name != null ? p.name : "");
            etProdPrice.setText(p.unitPrice != null ? String.valueOf(p.unitPrice) : "");

            editableSales.clear();
            btnCommit.setEnabled(false);
            currentPreviewToken[0] = null;
            previewCard.setVisibility(View.GONE);

            repository.getProductSales(activeSession.id, p.id, new SalesRepository.Callback<List<ProductSale>>() {
                @Override
                public void onSuccess(List<ProductSale> sales) {
                    for (ProductSale ps : sales) {
                        editableSales.add(new EditableSale(
                            ps.id,
                            ps.revision,
                            ps.buyerId,
                            ps.buyerNickname,
                            ps.quantity,
                            ps.unitPrice,
                            ps.amount,
                            !"ACTIVE".equals(ps.recordState)
                        ));
                    }
                    renderSalesRef[0].run();
                }

                @Override
                public void onError(SalesError error) {
                    Toast.makeText(context, "판매목록 조회 실패: " + error.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        };

        // Load Session Products
        repository.listSessionProducts(activeSession.id, new SalesRepository.Callback<List<Product>>() {
            @Override
            public void onSuccess(List<Product> products) {
                sessionProducts.clear();
                sessionProducts.addAll(products);

                List<String> prodLabels = new ArrayList<>();
                int selectedIdx = 0;
                for (int i = 0; i < products.size(); i++) {
                    Product p = products.get(i);
                    prodLabels.add(p.productCode + " - " + (p.name != null ? p.name : "이름 없음") + " (" + (p.unitPrice != null ? "₩" + p.unitPrice : "가격 미지정") + ")");
                    if (activeProduct != null && p.id.equals(activeProduct.id)) {
                        selectedIdx = i;
                    }
                }

                ArrayAdapter<String> adapter = new ArrayAdapter<>(context, android.R.layout.simple_spinner_dropdown_item, prodLabels);
                spProducts.setAdapter(adapter);
                spProducts.setSelection(selectedIdx);

                if (!products.isEmpty()) {
                    currentProduct[0] = products.get(selectedIdx);
                    loadSalesForSelectedProduct.run();
                }

                spProducts.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                    @Override
                    public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                        currentProduct[0] = sessionProducts.get(position);
                        loadSalesForSelectedProduct.run();
                    }

                    @Override
                    public void onNothingSelected(AdapterView<?> parent) {}
                });
            }

            @Override
            public void onError(SalesError error) {
                Toast.makeText(context, "상품 목록 조회 실패: " + error.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });

        // Add Buyer Button
        btnAddBuyer.setOnClickListener(v -> {
            BuyerConfirmDialog.show(context, repository, "", confirmedBuyer -> {
                editableSales.add(new EditableSale(
                    null,
                    null,
                    confirmedBuyer.id,
                    confirmedBuyer.displayNickname,
                    1,
                    0L,
                    0L,
                    false
                ));
                btnCommit.setEnabled(false);
                currentPreviewToken[0] = null;
                renderSalesRef[0].run();
            });
        });

        // Preview Button
        btnPreview.setOnClickListener(v -> {
            if (currentProduct[0] == null) return;
            Product p = currentProduct[0];

            String priceText = etProdPrice.getText().toString().trim();
            Long proposedPrice = null;
            if (!priceText.isEmpty()) {
                try {
                    proposedPrice = Long.parseLong(priceText);
                } catch (NumberFormatException e) {
                    Toast.makeText(context, "올바른 판매단가를 입력하세요.", Toast.LENGTH_SHORT).show();
                    return;
                }
            }

            List<ProposedSale> propSales = new ArrayList<>();
            for (EditableSale es : editableSales) {
                propSales.add(new ProposedSale(
                    es.saleId,
                    es.expectedRevision,
                    es.buyerId,
                    es.quantity,
                    es.cancelled
                ));
            }

            btnPreview.setEnabled(false);
            btnPreview.setText("계산 중...");

            repository.previewProductChange(
                p.id,
                p.revision,
                p.salesRevision,
                proposedPrice,
                propSales,
                new SalesRepository.Callback<PreviewChangeResult>() {
                    @Override
                    public void onSuccess(PreviewChangeResult res) {
                        btnPreview.setEnabled(true);
                        btnPreview.setText("변경 미리보기");
                        currentPreviewToken[0] = res.previewToken;
                        btnCommit.setEnabled(true);

                        // Show Preview Results
                        previewCard.removeAllViews();
                        previewCard.setVisibility(View.VISIBLE);

                        TextView title = new TextView(context);
                        title.setText("📊 변경 미리보기 결과");
                        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                        title.setTextColor(Color.rgb(15, 23, 42));
                        previewCard.addView(title);

                        String diffSign = res.diffAmount >= 0 ? "+₩" : "-₩";
                        String diffFmt = diffSign + NumberFormat.getNumberInstance(Locale.KOREA).format(Math.abs(res.diffAmount));

                        TextView summary = new TextView(context);
                        summary.setText("단가: ₩" + res.beforeUnitPrice + " → ₩" + res.afterUnitPrice +
                            "\n회차 총액: ₩" + res.beforeSessionAmount + " → ₩" + res.afterSessionAmount +
                            " (증감: " + diffFmt + ")");
                        summary.setTextSize(13);
                        summary.setPadding(0, pad / 4, 0, pad / 4);
                        summary.setTextColor(Color.rgb(2, 111, 199));
                        previewCard.addView(summary);

                        TextView alert = new TextView(context);
                        alert.setText("⚠️ 알림: 단가 변경 시 기존 판매 전체에 적용되며 정정 전표가 발생합니다.");
                        alert.setTextSize(11);
                        alert.setTextColor(Color.rgb(225, 29, 72));
                        alert.setPadding(0, 0, 0, pad / 4);
                        previewCard.addView(alert);

                        TextView buyersTitle = new TextView(context);
                        buyersTitle.setText("영향받는 구매자 (" + res.affectedBuyers.size() + "명):");
                        buyersTitle.setTextSize(12);
                        buyersTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                        previewCard.addView(buyersTitle);

                        for (AffectedBuyer ab : res.affectedBuyers) {
                            TextView bRow = new TextView(context);
                            String bDiff = (ab.diffAmount >= 0 ? "+₩" : "-₩") + NumberFormat.getNumberInstance(Locale.KOREA).format(Math.abs(ab.diffAmount));
                            bRow.setText("• " + ab.displayNickname + ": " + ab.quantity + "개 (₩" + ab.oldAmount + " → ₩" + ab.newAmount + ", " + bDiff + ")");
                            bRow.setTextSize(12);
                            bRow.setTextColor(Color.rgb(51, 65, 85));
                            previewCard.addView(bRow);
                        }
                    }

                    @Override
                    public void onError(SalesError error) {
                        btnPreview.setEnabled(true);
                        btnPreview.setText("변경 미리보기");
                        btnCommit.setEnabled(false);
                        currentPreviewToken[0] = null;
                        Toast.makeText(context, "미리보기 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            );
        });

        // Commit Button
        btnCommit.setOnClickListener(v -> {
            if (currentPreviewToken[0] == null) {
                Toast.makeText(context, "먼저 변경 미리보기를 실행해 주세요.", Toast.LENGTH_SHORT).show();
                return;
            }

            btnCommit.setEnabled(false);
            btnCommit.setText("적용 중...");

            String opId = UUID.randomUUID().toString();
            repository.commitProductChange(opId, currentPreviewToken[0], new SalesRepository.Callback<CommitProductChangeResult>() {
                @Override
                public void onSuccess(CommitProductChangeResult result) {
                    btnCommit.setText("변경 적용");
                    StringBuilder sb = new StringBuilder("상품 및 판매 변경이 완료되었습니다!\n");
                    if (result.printJobs != null && !result.printJobs.isEmpty()) {
                        sb.append("\n발행된 전표 (").append(result.printJobs.size()).append("건):\n");
                        for (PrintJobInfo pj : result.printJobs) {
                            sb.append("• [").append(mapPrintStatus(pj.status)).append("] ")
                              .append(pj.buyerNickname).append(" (₩").append(pj.amount).append(")\n");
                        }
                    }

                    AlertDialog resultDialog = new AlertDialog.Builder(context)
                        .setTitle("수정 완료")
                        .setMessage(sb.toString().trim())
                        .setPositiveButton("확인", (d, w) -> {
                            d.dismiss();
                            dialog.dismiss();
                            if (onProductChanged != null) onProductChanged.run();
                        })
                        .create();
                    resultDialog.show();
                }

                @Override
                public void onError(SalesError error) {
                    btnCommit.setEnabled(true);
                    btnCommit.setText("변경 적용");
                    Toast.makeText(context, "변경 적용 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        });
    }

    private static String mapPrintStatus(String status) {
        if ("QUEUED".equals(status)) return "출력 대기";
        if ("CLAIMED".equals(status)) return "처리 준비";
        if ("SUBMITTING".equals(status)) return "접수 중";
        if ("SUBMITTED".equals(status)) return "Windows 인쇄 접수";
        if ("FAILED".equals(status)) return "실패";
        return "출력 여부 확인 필요";
    }

    private static int dp(Context context, int v) {
        return (int) (v * context.getResources().getDisplayMetrics().density);
    }

    private static GradientDrawable roundRect(Context context, int bg, int border, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setStroke(dp(context, 1), border);
        d.setCornerRadius(dp(context, radiusDp));
        return d;
    }
}
