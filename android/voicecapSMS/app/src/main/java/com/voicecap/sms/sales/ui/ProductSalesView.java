package com.voicecap.sms.sales.ui;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.model.SalesModels.*;

import java.text.NumberFormat;
import java.util.*;

public class ProductSalesView extends LinearLayout {
    private final SalesRepository repository;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable pollRunnable = this::pollFeed;

    private BootstrapData bootstrap;
    private SalesFeedData feed;
    private boolean isPolling = false;

    // Selection tracking: buyerId -> SelectedBuyer
    private static final class SelectedBuyer {
        String buyerId;
        String nickname;
        int quantity;
        final Set<String> sourceCommentIds = new HashSet<>();
        SelectedBuyer(String buyerId, String nickname, int quantity) {
            this.buyerId = buyerId;
            this.nickname = nickname;
            this.quantity = quantity;
        }
    }
    private final Map<String, SelectedBuyer> selectedBuyers = new HashMap<>();

    // UI elements
    private TextView tvSessionTitle;
    private TextView tvSummaryStats;
    private TextView tvActiveProduct;
    private TextView tvPrinterBadge;
    private LinearLayout commentsContainer;
    private TextView tvBottomStats;
    private Button btnCommitSales;
    private Button btnRegisterProduct;

    public ProductSalesView(Context context, SalesRepository repository) {
        super(context);
        this.repository = repository;
        setOrientation(VERTICAL);
        setBackgroundColor(Color.rgb(248, 250, 252));
        buildUi();
    }

    private void buildUi() {
        int pad = dp(16);
        setPadding(pad, pad, pad, dp(80)); // Bottom padding for sticky bar

        // 1. Header with Title & Action Buttons
        LinearLayout header = new LinearLayout(getContext());
        header.setOrientation(HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        LinearLayout titleCol = new LinearLayout(getContext());
        titleCol.setOrientation(VERTICAL);
        LinearLayout.LayoutParams tParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleCol.setLayoutParams(tParams);

        TextView title = new TextView(getContext());
        title.setText("🛍 라이브 판매관리");
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setTextColor(Color.rgb(15, 23, 42));
        titleCol.addView(title);

        tvSessionTitle = new TextView(getContext());
        tvSessionTitle.setText("회차 불러오는 중...");
        tvSessionTitle.setTextSize(13);
        tvSessionTitle.setTextColor(Color.rgb(100, 116, 139));
        titleCol.addView(tvSessionTitle);
        header.addView(titleCol);

        Button btnSettings = new Button(getContext());
        btnSettings.setText("설정");
        btnSettings.setTextSize(12);
        btnSettings.setOnClickListener(v -> {
            if (bootstrap != null && bootstrap.settings != null) {
                SalesSettingsDialog.show(getContext(), repository, bootstrap.settings, newSettings -> {
                    loadBootstrap();
                });
            }
        });
        header.addView(btnSettings);

        btnRegisterProduct = new Button(getContext());
        btnRegisterProduct.setText("+ 상품등록");
        btnRegisterProduct.setTextSize(12);
        btnRegisterProduct.setOnClickListener(v -> {
            if (bootstrap != null) {
                ProductRegistrationDialog.show(
                    getContext(),
                    repository,
                    bootstrap.activeSession,
                    bootstrap.settings,
                    (prod, sess) -> loadBootstrap()
                );
            }
        });
        header.addView(btnRegisterProduct);
        addView(header);

        // 2. Active Product & Summary Card
        LinearLayout card = new LinearLayout(getContext());
        card.setOrientation(VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(roundRect(Color.WHITE, Color.rgb(226, 232, 240), dp(12)));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardParams.topMargin = dp(12);
        card.setLayoutParams(cardParams);

        tvSummaryStats = new TextView(getContext());
        tvSummaryStats.setText("이번 회차: 0개 · ₩0");
        tvSummaryStats.setTextSize(16);
        tvSummaryStats.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        tvSummaryStats.setTextColor(Color.rgb(2, 111, 199));
        card.addView(tvSummaryStats);

        tvActiveProduct = new TextView(getContext());
        tvActiveProduct.setText("현재 상품: 없음");
        tvActiveProduct.setTextSize(14);
        tvActiveProduct.setTextColor(Color.rgb(51, 65, 85));
        tvActiveProduct.setPadding(0, dp(6), 0, 0);
        card.addView(tvActiveProduct);

        tvPrinterBadge = new TextView(getContext());
        tvPrinterBadge.setText("프린터: 상태 확인 중...");
        tvPrinterBadge.setTextSize(12);
        tvPrinterBadge.setTextColor(Color.rgb(100, 116, 139));
        tvPrinterBadge.setPadding(0, dp(4), 0, 0);
        card.addView(tvPrinterBadge);

        addView(card);

        // 3. Comments List in ScrollView
        TextView feedTitle = new TextView(getContext());
        feedTitle.setText("실시간 댓글 목록");
        feedTitle.setTextSize(14);
        feedTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        feedTitle.setTextColor(Color.rgb(71, 85, 105));
        feedTitle.setPadding(0, dp(14), 0, dp(6));
        addView(feedTitle);

        ScrollView scrollView = new ScrollView(getContext());
        LinearLayout.LayoutParams sParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        scrollView.setLayoutParams(sParams);

        commentsContainer = new LinearLayout(getContext());
        commentsContainer.setOrientation(VERTICAL);
        scrollView.addView(commentsContainer);
        addView(scrollView);

        // 4. Sticky Bottom Action Bar
        LinearLayout bottomBar = new LinearLayout(getContext());
        bottomBar.setOrientation(HORIZONTAL);
        bottomBar.setGravity(Gravity.CENTER_VERTICAL);
        bottomBar.setPadding(dp(14), dp(10), dp(14), dp(10));
        bottomBar.setBackground(roundRect(Color.rgb(15, 23, 42), Color.rgb(30, 41, 59), dp(16)));

        tvBottomStats = new TextView(getContext());
        tvBottomStats.setText("선택: 0명 (총 0개)");
        tvBottomStats.setTextColor(Color.WHITE);
        tvBottomStats.setTextSize(14);
        tvBottomStats.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams bStatsParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tvBottomStats.setLayoutParams(bStatsParams);
        bottomBar.addView(tvBottomStats);

        btnCommitSales = new Button(getContext());
        btnCommitSales.setText("판매등록완료");
        btnCommitSales.setTextSize(14);
        btnCommitSales.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        btnCommitSales.setTextColor(Color.WHITE);
        btnCommitSales.setBackground(roundRect(Color.rgb(14, 140, 233), Color.rgb(2, 111, 199), dp(10)));
        btnCommitSales.setOnClickListener(v -> commitCurrentSales());
        bottomBar.addView(btnCommitSales);

        addView(bottomBar);
    }

    public void start() {
        isPolling = true;
        loadBootstrap();
    }

    public void stop() {
        isPolling = false;
        mainHandler.removeCallbacks(pollRunnable);
    }

    private void loadBootstrap() {
        repository.getBootstrap(new SalesRepository.Callback<BootstrapData>() {
            @Override
            public void onSuccess(BootstrapData data) {
                bootstrap = data;
                updateHeader();
                pollFeed();
            }

            @Override
            public void onError(SalesError error) {
                Toast.makeText(getContext(), "부트스트랩 실패: " + error.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void updateHeader() {
        if (bootstrap == null) return;

        if (bootstrap.activeSession != null) {
            tvSessionTitle.setText(bootstrap.activeSession.displayCode + " (v" + bootstrap.activeSession.revision + ")");
        } else {
            tvSessionTitle.setText("진행 중인 회차 없음");
        }

        if (bootstrap.activeProduct != null) {
            String priceStr = bootstrap.activeProduct.unitPrice != null
                ? "₩" + NumberFormat.getNumberInstance(Locale.KOREA).format(bootstrap.activeProduct.unitPrice)
                : "가격 미지정";
            String kind = "PHOTO".equals(bootstrap.activeProduct.imageKind) ? "[사진]" : "[번호이미지]";
            tvActiveProduct.setText("현재 상품: " + bootstrap.activeProduct.productCode + " · " + (bootstrap.activeProduct.name != null ? bootstrap.activeProduct.name : "") + " (" + priceStr + ") " + kind);
        } else {
            tvActiveProduct.setText("현재 판매 중인 상품이 없습니다. 새 상품을 등록하세요.");
        }

        if (bootstrap.printerStatus != null) {
            String pName = bootstrap.printerStatus.outputDeviceName != null ? bootstrap.printerStatus.outputDeviceName : "출력 프린터 미지정";
            String status = bootstrap.printerStatus.online ? "온라인" : "오프라인";
            tvPrinterBadge.setText("프린터: " + pName + " (" + status + ")");
        }

        if (bootstrap.settings != null) {
            btnRegisterProduct.setVisibility(bootstrap.settings.productRegistrationEnabled ? VISIBLE : GONE);
        }
    }

    private void pollFeed() {
        if (!isPolling || bootstrap == null || bootstrap.activeSession == null) return;

        List<String> watched = new ArrayList<>(selectedBuyers.keySet());
        repository.getSalesFeed(bootstrap.activeSession.id, watched, null, new SalesRepository.Callback<SalesFeedData>() {
            @Override
            public void onSuccess(SalesFeedData data) {
                feed = data;
                renderFeed();
                if (isPolling) {
                    mainHandler.removeCallbacks(pollRunnable);
                    mainHandler.postDelayed(pollRunnable, 1500);
                }
            }

            @Override
            public void onError(SalesError error) {
                if (isPolling) {
                    mainHandler.removeCallbacks(pollRunnable);
                    mainHandler.postDelayed(pollRunnable, 3000);
                }
            }
        });
    }

    private void renderFeed() {
        if (feed == null) return;

        // Update summary
        if (feed.summary != null) {
            String amtStr = NumberFormat.getNumberInstance(Locale.KOREA).format(feed.summary.sessionAmount);
            tvSummaryStats.setText("이번 회차: " + feed.summary.sessionQuantity + "개 · ₩" + amtStr);
        }

        commentsContainer.removeAllViews();

        if (feed.comments.isEmpty()) {
            TextView empty = new TextView(getContext());
            empty.setText("수집된 댓글이 아직 없습니다.");
            empty.setTextSize(13);
            empty.setTextColor(Color.rgb(148, 163, 184));
            empty.setPadding(0, dp(16), 0, 0);
            commentsContainer.addView(empty);
            return;
        }

        for (LiveComment c : feed.comments) {
            commentsContainer.addView(buildCommentRow(c));
        }

        updateBottomStats();
    }

    private View buildCommentRow(LiveComment comment) {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(8), dp(10), dp(8));

        String buyerId = comment.buyerId != null ? comment.buyerId : comment.nicknameSnapshot;
        boolean isSelected = selectedBuyers.containsKey(buyerId) && selectedBuyers.get(buyerId).sourceCommentIds.contains(comment.id);

        row.setBackground(roundRect(
            isSelected ? Color.rgb(238, 242, 255) : Color.WHITE,
            isSelected ? Color.rgb(99, 102, 241) : Color.rgb(241, 245, 249),
            dp(8)
        ));
        LinearLayout.LayoutParams rParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rParams.bottomMargin = dp(6);
        row.setLayoutParams(rParams);

        CheckBox cb = new CheckBox(getContext());
        cb.setChecked(isSelected);
        cb.setClickable(false);
        row.addView(cb);

        LinearLayout contentCol = new LinearLayout(getContext());
        contentCol.setOrientation(VERTICAL);
        LinearLayout.LayoutParams cParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        contentCol.setLayoutParams(cParams);

        TextView nick = new TextView(getContext());
        nick.setText(comment.nicknameSnapshot);
        nick.setTextSize(13);
        nick.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        nick.setTextColor(Color.rgb(30, 41, 59));
        contentCol.addView(nick);

        TextView text = new TextView(getContext());
        text.setText(comment.content);
        text.setTextSize(14);
        text.setTextColor(Color.rgb(15, 23, 42));
        contentCol.addView(text);

        // Buyer Stats (this session & total)
        BuyerStats bs = feed != null && comment.buyerId != null ? feed.buyerStats.get(comment.buyerId) : null;
        if (bs != null) {
            TextView statsView = new TextView(getContext());
            statsView.setText("회차 " + bs.sessionQuantity + "개 (₩" + bs.sessionAmount + ") · 누적 " + bs.totalPurchaseCount + "회 (₩" + bs.totalPurchaseAmount + ")");
            statsView.setTextSize(11);
            statsView.setTextColor(Color.rgb(100, 116, 139));
            contentCol.addView(statsView);
        }
        row.addView(contentCol);

        // Quantity controls if buyer is selected
        if (selectedBuyers.containsKey(buyerId)) {
            SelectedBuyer sb = selectedBuyers.get(buyerId);

            Button minusBtn = new Button(getContext());
            minusBtn.setText("-");
            minusBtn.setTextSize(12);
            minusBtn.setLayoutParams(new LinearLayout.LayoutParams(dp(36), dp(36)));
            minusBtn.setOnClickListener(v -> {
                if (sb.quantity > 1) {
                    sb.quantity -= 1;
                    updateBottomStats();
                }
            });
            row.addView(minusBtn);

            TextView qtyView = new TextView(getContext());
            qtyView.setText(String.valueOf(sb.quantity));
            qtyView.setTextSize(14);
            qtyView.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            qtyView.setPadding(dp(6), 0, dp(6), 0);
            row.addView(qtyView);

            Button plusBtn = new Button(getContext());
            plusBtn.setText("+");
            plusBtn.setTextSize(12);
            plusBtn.setLayoutParams(new LinearLayout.LayoutParams(dp(36), dp(36)));
            plusBtn.setOnClickListener(v -> {
                sb.quantity += 1;
                updateBottomStats();
            });
            row.addView(plusBtn);
        }

        row.setOnClickListener(v -> {
            toggleCommentSelection(comment, buyerId);
            renderFeed();
        });

        return row;
    }

    private void toggleCommentSelection(LiveComment comment, String buyerId) {
        if (selectedBuyers.containsKey(buyerId)) {
            SelectedBuyer sb = selectedBuyers.get(buyerId);
            if (sb.sourceCommentIds.contains(comment.id)) {
                sb.sourceCommentIds.remove(comment.id);
                // If last comment unselected, remove buyer
                if (sb.sourceCommentIds.isEmpty()) {
                    selectedBuyers.remove(buyerId);
                }
            } else {
                sb.sourceCommentIds.add(comment.id);
                // Note: Adding another comment does NOT increase quantity (remains default 1) per contract!
            }
        } else {
            // Newly selected buyer: default quantity is 1
            SelectedBuyer sb = new SelectedBuyer(buyerId, comment.nicknameSnapshot, 1);
            sb.sourceCommentIds.add(comment.id);
            selectedBuyers.put(buyerId, sb);
        }
        updateBottomStats();
    }

    private void updateBottomStats() {
        int buyerCount = selectedBuyers.size();
        int totalQty = 0;
        for (SelectedBuyer sb : selectedBuyers.values()) {
            totalQty += sb.quantity;
        }

        long unitPrice = bootstrap != null && bootstrap.activeProduct != null && bootstrap.activeProduct.unitPrice != null
            ? bootstrap.activeProduct.unitPrice : 0L;
        long totalAmount = totalQty * unitPrice;

        String amtStr = NumberFormat.getNumberInstance(Locale.KOREA).format(totalAmount);
        tvBottomStats.setText("선택 " + buyerCount + "명 (" + totalQty + "개) · ₩" + amtStr);
        btnCommitSales.setEnabled(buyerCount > 0);
    }

    private void commitCurrentSales() {
        if (bootstrap == null || bootstrap.activeSession == null || bootstrap.activeProduct == null) {
            Toast.makeText(getContext(), "활성 회차 또는 상품이 없습니다.", Toast.LENGTH_SHORT).show();
            return;
        }

        if (bootstrap.activeProduct.unitPrice == null) {
            Toast.makeText(getContext(), "상품 단가가 없습니다. 가격을 먼저 설정해 주세요.", Toast.LENGTH_LONG).show();
            return;
        }

        List<CommitSaleBuyer> commitList = new ArrayList<>();
        for (SelectedBuyer sb : selectedBuyers.values()) {
            commitList.add(new CommitSaleBuyer(sb.buyerId, sb.quantity, new ArrayList<>(sb.sourceCommentIds)));
        }

        btnCommitSales.setEnabled(false);
        btnCommitSales.setText("저장 중...");

        String opId = UUID.randomUUID().toString();
        repository.commitSales(
            opId,
            bootstrap.activeSession.id,
            bootstrap.activeProduct.id,
            bootstrap.activeProduct.revision,
            bootstrap.activeSession.revision,
            commitList,
            new SalesRepository.Callback<SalesResult>() {
                @Override
                public void onSuccess(SalesResult result) {
                    Toast.makeText(getContext(), "판매 " + result.totalQuantity + "개(총 " + result.saleIds.size() + "건) 저장 완료!", Toast.LENGTH_LONG).show();
                    selectedBuyers.clear();
                    btnCommitSales.setEnabled(true);
                    btnCommitSales.setText("판매등록완료");
                    loadBootstrap();
                }

                @Override
                public void onError(SalesError error) {
                    btnCommitSales.setEnabled(true);
                    btnCommitSales.setText("판매등록완료");
                    Toast.makeText(getContext(), "판매 저장 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable roundRect(int bg, int border, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setStroke(dp(1), border);
        d.setCornerRadius(radius);
        return d;
    }
}
