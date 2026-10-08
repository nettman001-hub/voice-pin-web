package com.voicecap.sms;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 새 문자: 번호 입력 + 연락처 검색. 받는 사람이 여러 명이면 그룹 MMS가 아니라 각자에게 따로 보낸다
 * (손님끼리 번호가 보이지 않게). 사진을 붙이면 각자에게 MMS로 보낸다. 수신자 사이에는 1초 간격을 둔다.
 */
public final class ComposeActivity extends MessagingActivity {
    static final String EXTRA_RECIPIENTS = "recipients";
    static final String EXTRA_BODY = "body";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<String> recipients = new ArrayList<>();
    private ConversationStore store;
    private LinearLayout recipientList;
    private EditText recipientInput;
    private LinearLayout suggestions;
    private TextView contactsHint;
    private TextView progress;
    private boolean sending;
    private int searchToken;

    static Intent intent(Context context, String recipients, String body) {
        Intent intent = new Intent(context, ComposeActivity.class);
        if (recipients != null) intent.putExtra(EXTRA_RECIPIENTS, recipients);
        if (body != null) intent.putExtra(EXTRA_BODY, body);
        return intent;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new ConversationStore(this);
        titleView.setText("새 문자");

        ScrollView scroll = new ScrollView(this);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(Ui.dp(this, 16), Ui.dp(this, 12), Ui.dp(this, 16), Ui.dp(this, 12));
        scroll.addView(column);

        TextView label = Ui.title(this, "받는 사람", 14);
        column.addView(label);
        recipientList = new LinearLayout(this);
        recipientList.setOrientation(LinearLayout.VERTICAL);
        column.addView(recipientList);

        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        recipientInput = new EditText(this);
        recipientInput.setHint("이름 또는 번호 (여러 명은 쉼표로)");
        recipientInput.setTextSize(15);
        recipientInput.setSingleLine(true);
        recipientInput.setInputType(InputType.TYPE_CLASS_TEXT);
        recipientInput.setImeOptions(EditorInfo.IME_ACTION_DONE);
        recipientInput.setOnEditorActionListener((v, actionId, event) -> {
            addTypedRecipients();
            return true;
        });
        recipientInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable s) { search(s.toString()); }
        });
        inputRow.addView(recipientInput, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView add = new TextView(this);
        add.setText("추가");
        add.setTextColor(Ui.BRAND_600);
        add.setTextSize(15);
        add.setGravity(Gravity.CENTER);
        add.setOnClickListener(v -> addTypedRecipients());
        inputRow.addView(add, new LinearLayout.LayoutParams(Ui.dp(this, 56), Ui.dp(this, 48)));
        column.addView(inputRow);

        contactsHint = new TextView(this);
        contactsHint.setText("연락처에서 이름으로 찾으려면 눌러서 연락처 권한을 허용하세요 (선택).");
        contactsHint.setTextSize(13);
        contactsHint.setTextColor(Ui.BRAND_600);
        contactsHint.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 6));
        contactsHint.setOnClickListener(v -> requestContactsPermission());
        column.addView(contactsHint);

        suggestions = new LinearLayout(this);
        suggestions.setOrientation(LinearLayout.VERTICAL);
        column.addView(suggestions);

        progress = Ui.body(this, "");
        progress.setVisibility(View.GONE);
        column.addView(progress);

        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        addSendBar(this::send);

        String initial = getIntent().getStringExtra(EXTRA_RECIPIENTS);
        for (String number : ConversationLogic.parseRecipients(initial)) addRecipient(number);
        String body = getIntent().getStringExtra(EXTRA_BODY);
        if (body != null) sendBar.setText(body);
        updateContactsHint();
    }

    @Override
    protected void onContactsPermissionResult(boolean granted) {
        store.clearCaches();
        updateContactsHint();
        search(recipientInput.getText().toString());
        renderRecipients();
    }

    private void updateContactsHint() {
        contactsHint.setVisibility(ConversationStore.canReadContacts(this) ? View.GONE : View.VISIBLE);
    }

    private void addTypedRecipients() {
        List<String> numbers = ConversationLogic.parseRecipients(recipientInput.getText().toString());
        if (numbers.isEmpty()) return;
        for (String number : numbers) addRecipient(number);
        recipientInput.setText("");
    }

    private void addRecipient(String number) {
        String normalized = BusinessContactStore.normalize(number);
        for (String existing : recipients) if (BusinessContactStore.normalize(existing).equals(normalized)) return;
        recipients.add(number);
        renderRecipients();
    }

    private void renderRecipients() {
        recipientList.removeAllViews();
        for (String number : new ArrayList<>(recipients)) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setBackground(Ui.roundRect(this, Ui.BRAND_50, Ui.BRAND_200, 14));
            row.setPadding(Ui.dp(this, 12), 0, 0, 0);
            TextView text = new TextView(this);
            text.setText(number);
            text.setTextColor(Ui.BRAND_800);
            text.setTextSize(14);
            row.addView(text, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            TextView remove = new TextView(this);
            remove.setText("✕");
            remove.setGravity(Gravity.CENTER);
            remove.setTextColor(Ui.SLATE_500);
            remove.setContentDescription(number + " 빼기");
            remove.setOnClickListener(v -> {
                recipients.remove(number);
                renderRecipients();
            });
            row.addView(remove, new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 40)));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.topMargin = Ui.dp(this, 6);
            recipientList.addView(row, params);
            EXECUTOR.execute(() -> {
                String name = store.contactName(number);
                if (name != null) main.post(() -> text.setText(name + "  " + number));
            });
        }
    }

    private void search(String query) {
        int token = ++searchToken;
        if (query.trim().isEmpty() || !ConversationStore.canReadContacts(this)) {
            suggestions.removeAllViews();
            return;
        }
        EXECUTOR.execute(() -> {
            List<String[]> found = store.searchContacts(query, 8);
            main.post(() -> {
                if (token != searchToken) return;
                suggestions.removeAllViews();
                for (String[] contact : found) {
                    TextView row = new TextView(this);
                    row.setText(contact[0] + "  " + contact[1]);
                    row.setTextSize(15);
                    row.setTextColor(Ui.SLATE_900);
                    row.setPadding(Ui.dp(this, 4), Ui.dp(this, 12), Ui.dp(this, 4), Ui.dp(this, 12));
                    row.setOnClickListener(v -> {
                        addRecipient(contact[1]);
                        recipientInput.setText("");
                    });
                    suggestions.addView(row);
                }
            });
        });
    }

    private void send(String body, int subId, List<Uri> images) {
        if (sending) return;
        addTypedRecipients();
        if (recipients.isEmpty()) {
            Toast.makeText(this, "받는 사람을 입력해 주세요.", Toast.LENGTH_SHORT).show();
            return;
        }
        List<String> targets = new ArrayList<>(recipients);
        sending = true;
        sendBar.setLocked(true);
        progress.setVisibility(View.VISIBLE);
        progress.setTextColor(Ui.SLATE_700);
        Context app = getApplicationContext();
        EXECUTOR.execute(() -> {
            List<String> failed = new ArrayList<>();
            boolean unrecorded = false;
            List<byte[]> jpegs = null;
            String prepareError = null;
            if (!images.isEmpty()) {
                main.post(() -> progress.setText("사진을 통신사 크기에 맞게 줄이는 중…"));
                try {
                    jpegs = MmsImages.prepare(app, images, body, subId);
                } catch (Exception error) {
                    prepareError = error.getMessage() == null ? "사진을 준비하지 못했습니다." : error.getMessage();
                    failed.addAll(targets);
                }
            }
            for (int index = 0; prepareError == null && index < targets.size(); index++) {
                int done = index;
                main.post(() -> progress.setText(targets.size() == 1 ? "보내는 중…" : "각자에게 따로 보내는 중… " + (done + 1) + "/" + targets.size()));
                if (index > 0) ChatActivity.sleep(ConversationLogic.MULTI_SEND_GAP_MILLIS);
                try {
                    if (images.isEmpty()) {
                        SmsSender.send(app, targets.get(index), body, subId, LocalDb.ORIGIN_DEVICE, null);
                    } else if (!MmsSender.send(app, targets.get(index), body, jpegs, subId).recorded) {
                        unrecorded = true;
                    }
                } catch (Exception error) {
                    failed.add(targets.get(index));
                }
            }
            String error = prepareError;
            boolean warn = unrecorded;
            main.post(() -> finishSend(targets, failed, error, warn));
        });
    }

    private void finishSend(List<String> targets, List<String> failed, String error, boolean unrecorded) {
        sending = false;
        if (unrecorded) Toast.makeText(this, ChatActivity.MMS_UNRECORDED, Toast.LENGTH_LONG).show();
        if (!failed.isEmpty()) {
            progress.setText((error != null ? error + "\n" : "") + "보내지 못한 번호: " + android.text.TextUtils.join(", ", failed));
            progress.setTextColor(Color.rgb(220, 38, 38));
            recipients.clear();
            recipients.addAll(failed);
            renderRecipients();
            updateSendLock();
            return;
        }
        if (targets.size() == 1) {
            startActivity(ChatActivity.intent(this, -1, targets.get(0)));
        } else {
            Toast.makeText(this, targets.size() + "명에게 각각 보냈습니다.", Toast.LENGTH_SHORT).show();
        }
        finish();
    }
}
