package com.voicecap.sms.sales.ui;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.ViewGroup;
import android.widget.*;
import com.voicecap.sms.sales.SalesRepository;
import com.voicecap.sms.sales.model.SalesModels.*;

import java.util.UUID;

public final class SalesSettingsDialog {
    private SalesSettingsDialog() {}

    public interface OnSettingsUpdatedListener {
        void onUpdated(Settings newSettings);
    }

    public static void show(Context context, SalesRepository repository, Settings currentSettings, OnSettingsUpdatedListener listener) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle("판매 설정");

        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (18 * context.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        CheckBox cbProductReg = new CheckBox(context);
        cbProductReg.setText("상품등록 기능 허용");
        cbProductReg.setChecked(currentSettings.productRegistrationEnabled);
        cbProductReg.setTextSize(15);
        layout.addView(cbProductReg);

        CheckBox cbCapturePhoto = new CheckBox(context);
        cbCapturePhoto.setText("상품사진 촬영 및 등록 허용");
        cbCapturePhoto.setChecked(currentSettings.captureProductImageEnabled);
        cbCapturePhoto.setTextSize(15);
        layout.addView(cbCapturePhoto);

        CheckBox cbNameInput = new CheckBox(context);
        cbNameInput.setText("상품명 / 번호 수동 입력 허용");
        cbNameInput.setChecked(currentSettings.productNameInputEnabled);
        cbNameInput.setTextSize(15);
        layout.addView(cbNameInput);

        TextView info = new TextView(context);
        info.setText("사진 촬영 OFF 시 번호이미지로 등록되며, 상품명 OFF 시 자동 번호가 부여됩니다.");
        info.setTextSize(12);
        info.setTextColor(Color.rgb(100, 116, 139));
        info.setPadding(0, pad / 2, 0, pad / 2);
        layout.addView(info);

        builder.setView(layout);

        builder.setPositiveButton("저장", null);
        builder.setNegativeButton("취소", (dialog, which) -> dialog.dismiss());

        AlertDialog dialog = builder.create();
        dialog.show();

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            Settings updated = new Settings(
                currentSettings.revision,
                cbProductReg.isChecked(),
                cbCapturePhoto.isChecked(),
                cbNameInput.isChecked(),
                currentSettings.voicePreviewMs
            );

            String opId = UUID.randomUUID().toString();
            repository.updateSettings(opId, currentSettings.revision, updated, new SalesRepository.Callback<Settings>() {
                @Override
                public void onSuccess(Settings result) {
                    Toast.makeText(context, "설정이 저장되었습니다.", Toast.LENGTH_SHORT).show();
                    if (listener != null) listener.onUpdated(result);
                    dialog.dismiss();
                }

                @Override
                public void onError(SalesError error) {
                    Toast.makeText(context, "설정 저장 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        });
    }
}
