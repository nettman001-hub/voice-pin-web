package com.voicecap.sms.sales.ui;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.model.SalesModels.*;

import java.util.List;
import java.util.UUID;

public final class BuyerConfirmDialog {
    private BuyerConfirmDialog() {}

    public interface OnBuyerConfirmedListener {
        void onConfirmed(Buyer buyer);
    }

    public static void show(
        Context context,
        SalesRepository repository,
        String nicknameSnapshot,
        OnBuyerConfirmedListener listener
    ) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle("구매자 신원 확인");

        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * context.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        TextView info = new TextView(context);
        info.setText("동명이인 자동 병합 금지: 댓글 닉네임 '" + nicknameSnapshot + "'의 신원을 확인해 주세요.\n기존 등록된 구매자 후보를 선택하거나 새 수동 신원을 생성합니다.");
        info.setTextSize(12);
        info.setTextColor(Color.rgb(100, 116, 139));
        layout.addView(info);

        // Search Input
        LinearLayout searchRow = new LinearLayout(context);
        searchRow.setOrientation(LinearLayout.HORIZONTAL);
        searchRow.setGravity(Gravity.CENTER_VERTICAL);
        searchRow.setPadding(0, pad / 2, 0, pad / 2);

        EditText etSearch = new EditText(context);
        etSearch.setText(nicknameSnapshot);
        etSearch.setSingleLine(true);
        LinearLayout.LayoutParams etParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        etSearch.setLayoutParams(etParams);
        searchRow.addView(etSearch);

        Button btnSearch = new Button(context);
        btnSearch.setText("검색");
        searchRow.addView(btnSearch);
        layout.addView(searchRow);

        // Candidate List Container
        LinearLayout candidateContainer = new LinearLayout(context);
        candidateContainer.setOrientation(LinearLayout.VERTICAL);
        layout.addView(candidateContainer);

        // Manual confirm button
        Button btnManualConfirm = new Button(context);
        btnManualConfirm.setText("신규 구매자로 수동 확인 (MANUAL_CONFIRMED)");
        btnManualConfirm.setTextSize(13);
        LinearLayout.LayoutParams mcParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mcParams.topMargin = pad;
        btnManualConfirm.setLayoutParams(mcParams);
        layout.addView(btnManualConfirm);

        builder.setView(layout);
        builder.setNegativeButton("취소", (dialog, which) -> dialog.dismiss());

        AlertDialog dialog = builder.create();
        dialog.show();

        Runnable doSearch = () -> {
            String q = etSearch.getText().toString().trim();
            if (q.isEmpty()) return;

            btnSearch.setEnabled(false);
            candidateContainer.removeAllViews();
            TextView loading = new TextView(context);
            loading.setText("후보 검색 중...");
            loading.setTextColor(Color.rgb(148, 163, 184));
            candidateContainer.addView(loading);

            repository.searchBuyers(q, new SalesRepository.Callback<List<Buyer>>() {
                @Override
                public void onSuccess(List<Buyer> buyers) {
                    btnSearch.setEnabled(true);
                    candidateContainer.removeAllViews();
                    if (buyers.isEmpty()) {
                        TextView empty = new TextView(context);
                        empty.setText("일치하는 기존 구매자 후보가 없습니다.");
                        empty.setTextColor(Color.rgb(148, 163, 184));
                        candidateContainer.addView(empty);
                        return;
                    }

                    for (Buyer b : buyers) {
                        LinearLayout row = new LinearLayout(context);
                        row.setOrientation(LinearLayout.HORIZONTAL);
                        row.setGravity(Gravity.CENTER_VERTICAL);
                        row.setPadding(0, pad / 4, 0, pad / 4);

                        LinearLayout infoCol = new LinearLayout(context);
                        infoCol.setOrientation(LinearLayout.VERTICAL);
                        LinearLayout.LayoutParams cParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                        infoCol.setLayoutParams(cParams);

                        TextView tvNick = new TextView(context);
                        tvNick.setText(b.displayNickname + (b.platformUserId != null ? " (" + b.platformUserId + ")" : ""));
                        tvNick.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                        tvNick.setTextColor(Color.rgb(30, 41, 59));
                        infoCol.addView(tvNick);

                        TextView tvStatus = new TextView(context);
                        String statusLabel = "MANUAL_CONFIRMED".equals(b.identityStatus)
                            ? "[수동 확인됨 - 플랫폼 미검증]"
                            : ("RESOLVED".equals(b.identityStatus) ? "[플랫폼 검증됨]" : "[미확인]");
                        tvStatus.setText("상태: " + statusLabel);
                        tvStatus.setTextSize(11);
                        tvStatus.setTextColor(Color.rgb(100, 116, 139));
                        infoCol.addView(tvStatus);
                        row.addView(infoCol);

                        Button btnSelect = new Button(context);
                        btnSelect.setText("선택");
                        btnSelect.setOnClickListener(v -> {
                            btnSelect.setEnabled(false);
                            String opId = UUID.randomUUID().toString();
                            repository.confirmBuyer(opId, nicknameSnapshot, b.id, "기존 구매자 선택", new SalesRepository.Callback<Buyer>() {
                                @Override
                                public void onSuccess(Buyer confirmed) {
                                    Toast.makeText(context, "구매자 신원 확인 완료: " + confirmed.displayNickname, Toast.LENGTH_SHORT).show();
                                    listener.onConfirmed(confirmed);
                                    dialog.dismiss();
                                }

                                @Override
                                public void onError(SalesError error) {
                                    btnSelect.setEnabled(true);
                                    Toast.makeText(context, "확인 실패: " + error.getMessage(), Toast.LENGTH_SHORT).show();
                                }
                            });
                        });
                        row.addView(btnSelect);
                        candidateContainer.addView(row);
                    }
                }

                @Override
                public void onError(SalesError error) {
                    btnSearch.setEnabled(true);
                    candidateContainer.removeAllViews();
                    TextView err = new TextView(context);
                    err.setText("검색 실패: " + error.getMessage());
                    err.setTextColor(Color.RED);
                    candidateContainer.addView(err);
                }
            });
        };

        btnSearch.setOnClickListener(v -> doSearch.run());

        btnManualConfirm.setOnClickListener(v -> {
            btnManualConfirm.setEnabled(false);
            String opId = UUID.randomUUID().toString();
            repository.confirmBuyer(opId, nicknameSnapshot, null, "신규 구매자 수동 확인", new SalesRepository.Callback<Buyer>() {
                @Override
                public void onSuccess(Buyer confirmed) {
                    Toast.makeText(context, "수동 신원 생성 완료: " + confirmed.displayNickname, Toast.LENGTH_SHORT).show();
                    listener.onConfirmed(confirmed);
                    dialog.dismiss();
                }

                @Override
                public void onError(SalesError error) {
                    btnManualConfirm.setEnabled(true);
                    Toast.makeText(context, "확인 실패: " + error.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        });

        // Trigger initial search
        doSearch.run();
    }
}
