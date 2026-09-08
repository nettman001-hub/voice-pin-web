package com.voicecap.sms.sales.ui;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.CountDownTimer;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.model.SalesModels.*;

import java.util.UUID;

public final class ProductRegistrationDialog {
    private ProductRegistrationDialog() {}

    public interface OnProductRegisteredListener {
        void onRegistered(Product product, LiveSession session);
    }

    public static void show(
        Context context,
        SalesRepository repository,
        LiveSession session,
        Settings settings,
        OnProductRegisteredListener listener
    ) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle("신규 상품등록");

        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (18 * context.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        TextView labelCode = new TextView(context);
        labelCode.setText("상품번호 또는 상품명");
        labelCode.setTextSize(14);
        labelCode.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        layout.addView(labelCode);

        EditText etCodeOrName = new EditText(context);
        etCodeOrName.setHint("예: 0007 또는 실크 스카프");
        etCodeOrName.setSingleLine(true);
        if (!settings.productNameInputEnabled) {
            etCodeOrName.setEnabled(false);
            etCodeOrName.setHint("자동 번호 발급 모드");
        }
        layout.addView(etCodeOrName);

        TextView labelPrice = new TextView(context);
        labelPrice.setText("판매 단가 (원)");
        labelPrice.setTextSize(14);
        labelPrice.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        labelPrice.setPadding(0, pad / 2, 0, 0);
        layout.addView(labelPrice);

        EditText etPrice = new EditText(context);
        etPrice.setHint("예: 35000 (미입력 가능)");
        etPrice.setInputType(InputType.TYPE_CLASS_NUMBER);
        etPrice.setSingleLine(true);
        layout.addView(etPrice);

        TextView photoInfo = new TextView(context);
        photoInfo.setText(settings.captureProductImageEnabled ? "등록 시 2초 카운트다운 후 상품사진을 촬영합니다." : "사진 OFF 모드: 번호이미지로 등록됩니다.");
        photoInfo.setTextSize(12);
        photoInfo.setTextColor(Color.rgb(100, 116, 139));
        photoInfo.setPadding(0, pad / 2, 0, 0);
        layout.addView(photoInfo);

        builder.setView(layout);
        builder.setPositiveButton("등록", null);
        builder.setNegativeButton("취소", (dialog, which) -> dialog.dismiss());

        AlertDialog dialog = builder.create();
        dialog.show();

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String rawCodeOrName = etCodeOrName.getText().toString().trim();
            String rawPrice = etPrice.getText().toString().trim();

            Long price = null;
            if (!rawPrice.isEmpty()) {
                try {
                    price = Long.parseLong(rawPrice);
                } catch (NumberFormatException e) {
                    Toast.makeText(context, "올바른 금액을 입력해 주세요.", Toast.LENGTH_SHORT).show();
                    return;
                }
            }

            String requestedProductCode = null;
            String name = null;

            if (!rawCodeOrName.isEmpty()) {
                if (rawCodeOrName.matches("^\\d+$")) {
                    // All digits: preserve leading zeros (e.g. "0007")
                    requestedProductCode = rawCodeOrName;
                } else {
                    name = rawCodeOrName;
                }
            }

            dialog.dismiss();
            startRegistrationFlow(context, repository, session, settings, requestedProductCode, name, price, listener);
        });
    }

    private static void startRegistrationFlow(
        Context context,
        SalesRepository repository,
        LiveSession session,
        Settings settings,
        String requestedProductCode,
        String name,
        Long price,
        OnProductRegisteredListener listener
    ) {
        String prepareOpId = UUID.randomUUID().toString();
        String initialImageKind = settings.captureProductImageEnabled ? "PHOTO" : "NUMBER_IMAGE";

        Toast.makeText(context, "상품 초안을 준비하는 중...", Toast.LENGTH_SHORT).show();

        repository.prepareProduct(
            prepareOpId,
            session != null ? session.id : null,
            session != null ? session.revision : null,
            requestedProductCode,
            name,
            price,
            initialImageKind,
            new SalesRepository.Callback<PrepareProductResult>() {
                @Override
                public void onSuccess(PrepareProductResult prep) {
                    if (settings.captureProductImageEnabled) {
                        // Start 2s camera countdown flow
                        showCameraCountdown(context, repository, prep, session, listener);
                    } else {
                        // Directly commit with NUMBER_IMAGE
                        commitProductInternal(context, repository, prep.draftId, prep.draftRevision, session != null ? session.revision : 1, listener);
                    }
                }

                @Override
                public void onError(SalesError error) {
                    Toast.makeText(context, "상품 등록 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );
    }

    private static void showCameraCountdown(
        Context context,
        SalesRepository repository,
        PrepareProductResult prep,
        LiveSession session,
        OnProductRegisteredListener listener
    ) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setCancelable(false);

        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        int pad = (int) (32 * context.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        TextView icon = new TextView(context);
        icon.setText("📸");
        icon.setTextSize(48);
        icon.setGravity(Gravity.CENTER);
        layout.addView(icon);

        TextView countdownText = new TextView(context);
        countdownText.setText("2초 후 촬영합니다");
        countdownText.setTextSize(20);
        countdownText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        countdownText.setGravity(Gravity.CENTER);
        countdownText.setPadding(0, pad / 2, 0, pad / 2);
        layout.addView(countdownText);

        Button fallbackBtn = new Button(context);
        fallbackBtn.setText("촬영 건너뛰고 번호이미지로 등록");
        fallbackBtn.setTextSize(13);
        layout.addView(fallbackBtn);

        builder.setView(layout);
        AlertDialog countdownDialog = builder.create();
        countdownDialog.show();

        CountDownTimer timer = new CountDownTimer(2000, 500) {
            @Override
            public void onTick(long millisUntilFinished) {
                int sec = (int) (millisUntilFinished / 1000) + 1;
                countdownText.setText(sec + "초 후 촬영...");
            }

            @Override
            public void onFinish() {
                countdownDialog.dismiss();
                Toast.makeText(context, "촬영 완료! 상품을 확정합니다.", Toast.LENGTH_SHORT).show();
                commitProductInternal(context, repository, prep.draftId, prep.draftRevision, session != null ? session.revision : 1, listener);
            }
        };

        fallbackBtn.setOnClickListener(v -> {
            timer.cancel();
            countdownDialog.dismiss();
            // Fallback to NUMBER_IMAGE with imageFallbackConfirmed = true
            String updateOpId = UUID.randomUUID().toString();
            repository.updateProductDraft(
                updateOpId,
                prep.draftId,
                prep.draftRevision,
                "NUMBER_IMAGE",
                true,
                new SalesRepository.Callback<DraftData>() {
                    @Override
                    public void onSuccess(DraftData updatedDraft) {
                        Toast.makeText(context, "번호이미지로 전환되었습니다.", Toast.LENGTH_SHORT).show();
                        commitProductInternal(context, repository, updatedDraft.id, updatedDraft.draftRevision, session != null ? session.revision : 1, listener);
                    }

                    @Override
                    public void onError(SalesError error) {
                        Toast.makeText(context, "번호이미지 전환 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            );
        });

        timer.start();
    }

    private static void commitProductInternal(
        Context context,
        SalesRepository repository,
        String draftId,
        int draftRevision,
        int sessionRevision,
        OnProductRegisteredListener listener
    ) {
        String commitOpId = UUID.randomUUID().toString();
        repository.commitProduct(
            commitOpId,
            draftId,
            draftRevision,
            sessionRevision,
            new SalesRepository.Callback<CommitProductResult>() {
                @Override
                public void onSuccess(CommitProductResult result) {
                    Toast.makeText(context, "상품 '" + result.product.productCode + "'이(가) 등록되었습니다!", Toast.LENGTH_LONG).show();
                    if (listener != null) listener.onRegistered(result.product, result.session);
                }

                @Override
                public void onError(SalesError error) {
                    Toast.makeText(context, "상품 확정 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        );
    }
}
