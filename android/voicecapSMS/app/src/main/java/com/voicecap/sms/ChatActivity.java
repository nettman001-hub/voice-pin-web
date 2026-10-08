package com.voicecap.sms;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.database.ContentObserver;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Telephony;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 대화방: 좌(받은)/우(보낸) 말풍선, 날짜 구분선, MMS 사진 썸네일(누르면 전체 화면), 열면 읽음 처리,
 * 길게 눌러 복사·삭제, 통신사 전송 실패 시 "전송 실패 · 다시 보내기", 업무 고객 대화의 VoiceCAP 업로드 배지.
 */
public final class ChatActivity extends MessagingActivity {
    static final String EXTRA_THREAD_ID = "thread_id";
    static final String EXTRA_ADDRESS = "address";
    private static final int PAGE = 200;
    private static final long BADGE_REFRESH_MILLIS = 5000L;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Object> rows = new ArrayList<>();
    private final Adapter adapter = new Adapter();
    private ConversationStore store;
    private ListView list;
    private TextView olderButton;
    private long threadId = -1;
    private List<String> addresses = new ArrayList<>();
    private boolean business;
    private int limit = PAGE;
    private boolean resumed;
    private boolean hasPendingBadge;
    private ContentObserver observer;

    private static final class Row {
        ConversationStore.Message message;
        LocalDb.Item sync;
    }

    static Intent intent(Context context, long threadId, String address) {
        return new Intent(context, ChatActivity.class).putExtra(EXTRA_THREAD_ID, threadId).putExtra(EXTRA_ADDRESS, address);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new ConversationStore(this);
        threadId = getIntent().getLongExtra(EXTRA_THREAD_ID, -1);
        String address = getIntent().getStringExtra(EXTRA_ADDRESS);
        if (address != null && !address.isEmpty()) addresses.add(address);
        titleView.setText(address == null ? "대화" : address);

        list = new ListView(this);
        list.setDivider(null);
        list.setStackFromBottom(true);
        list.setTranscriptMode(AbsListView.TRANSCRIPT_MODE_NORMAL);
        list.setPadding(Ui.dp(this, 10), Ui.dp(this, 6), Ui.dp(this, 10), Ui.dp(this, 6));
        list.setClipToPadding(false);
        olderButton = new TextView(this);
        olderButton.setText("이전 문자 더 보기");
        olderButton.setTextColor(Ui.BRAND_600);
        olderButton.setGravity(Gravity.CENTER);
        olderButton.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
        olderButton.setOnClickListener(v -> {
            limit += PAGE;
            reload();
        });
        olderButton.setVisibility(View.GONE);
        LinearLayout header = new LinearLayout(this);
        header.addView(olderButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        list.addHeaderView(header, null, false);
        list.setAdapter(adapter);
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        addSendBar(this::send);

        observer = new ContentObserver(main) {
            @Override public void onChange(boolean selfChange) { scheduleReload(); }
        };
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        try {
            getContentResolver().registerContentObserver(Uri.parse("content://mms-sms/"), true, observer);
        } catch (RuntimeException ignored) { }
        reload();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        main.removeCallbacksAndMessages(null);
        getContentResolver().unregisterContentObserver(observer);
    }

    private final Runnable reloadTask = this::reload;

    private void scheduleReload() {
        main.removeCallbacks(reloadTask);
        main.postDelayed(reloadTask, 400);
    }

    /** 문자·배지를 다시 읽고, 대화를 읽음으로 표시한다. */
    private void reload() {
        int currentLimit = limit;
        List<String> knownAddresses = new ArrayList<>(addresses);
        long knownThread = threadId;
        Context app = getApplicationContext();
        EXECUTOR.execute(() -> {
            long id = knownThread;
            if (id < 0 && !knownAddresses.isEmpty()) {
                try {
                    id = Telephony.Threads.getOrCreateThreadId(app, knownAddresses.get(0));
                } catch (RuntimeException ignored) { }
            }
            ConversationStore.Conversation conversation = id < 0 ? null : store.thread(id);
            List<ConversationStore.Message> messages = id < 0 ? Collections.emptyList() : store.messages(id, currentLimit);
            List<String> uris = new ArrayList<>();
            for (ConversationStore.Message message : messages) uris.add(message.providerUri);
            Map<String, LocalDb.Item> sync = LocalDb.get(app).findByProviderUris(uris);
            if (id >= 0) store.markRead(id);
            long finalId = id;
            main.post(() -> show(finalId, conversation, messages, sync, currentLimit));
        });
    }

    private void show(long id, ConversationStore.Conversation conversation, List<ConversationStore.Message> messages,
                      Map<String, LocalDb.Item> sync, int currentLimit) {
        if (isFinishing() || isDestroyed()) return;
        threadId = id;
        if (conversation != null && !conversation.addresses.isEmpty()) {
            addresses = conversation.addresses;
            business = conversation.business;
            titleView.setText(conversation.title());
            String numbers = android.text.TextUtils.join(", ", conversation.addresses);
            boolean named = conversation.name != null && !conversation.name.isEmpty();
            String subtitle = (named ? numbers : "") + (business ? (named ? " · " : "") + "VoiceCAP 고객" : "")
                    + (conversation.blocked ? " · 차단된 번호" : "");
            subtitleView.setText(subtitle);
            subtitleView.setVisibility(subtitle.isEmpty() ? View.GONE : View.VISIBLE);
        }
        for (String address : addresses) MessageNotifier.cancel(this, MessageNotifier.conversationId(address));

        rows.clear();
        hasPendingBadge = false;
        TimeZone zone = TimeZone.getDefault();
        long lastDay = 0;
        for (ConversationStore.Message message : messages) {
            if (lastDay == 0 || !ConversationLogic.sameDay(lastDay, message.date, zone)) {
                rows.add(ConversationLogic.dayLabel(message.date, zone));
                lastDay = message.date;
            }
            Row row = new Row();
            row.message = message;
            row.sync = sync.get(message.providerUri);
            if (row.sync != null && ConversationLogic.badge(row.sync.state) == ConversationLogic.Badge.PENDING) hasPendingBadge = true;
            rows.add(row);
        }
        olderButton.setVisibility(messages.size() >= currentLimit ? View.VISIBLE : View.GONE);
        adapter.notifyDataSetChanged();
        // 업로드 대기 배지가 있으면 동기화 결과를 보려고 몇 초마다 다시 읽는다.
        main.removeCallbacks(reloadTask);
        if (resumed && hasPendingBadge) main.postDelayed(reloadTask, BADGE_REFRESH_MILLIS);
    }

    /** 대화 상대 모두에게 각각 SMS로 보낸다 (그룹 MMS 아님). */
    private void send(String body, int subId) {
        if (addresses.isEmpty()) {
            Toast.makeText(this, "받는 사람 번호가 없습니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        List<String> targets = new ArrayList<>(addresses);
        sendBar.clear();
        Context app = getApplicationContext();
        EXECUTOR.execute(() -> {
            String failure = null;
            for (int index = 0; index < targets.size(); index++) {
                if (index > 0) sleep(ConversationLogic.MULTI_SEND_GAP_MILLIS);
                try {
                    SmsSender.send(app, targets.get(index), body, subId, LocalDb.ORIGIN_DEVICE, null);
                } catch (Exception error) {
                    failure = error.getMessage() == null ? "문자를 보내지 못했습니다." : error.getMessage();
                }
            }
            String message = failure;
            main.post(() -> {
                if (message != null) {
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                    if (sendBar.text().isEmpty()) sendBar.setText(body);
                }
                reload();
            });
        });
    }

    static void sleep(long millis) {
        try {
            java.lang.Thread.sleep(millis);
        } catch (InterruptedException interrupted) {
            java.lang.Thread.currentThread().interrupt();
        }
    }

    private void resend(ConversationStore.Message message) {
        if (!canSend()) {
            requestDefaultSmsApp();
            return;
        }
        int subId = sendBar == null ? -1 : SimChooser.chosen(this, SimChooser.activeSims(this));
        Context app = getApplicationContext();
        EXECUTOR.execute(() -> {
            String failure = null;
            try {
                SmsSender.resend(app, message.providerUri, subId);
            } catch (Exception error) {
                failure = error.getMessage() == null ? "다시 보내지 못했습니다." : error.getMessage();
            }
            String text = failure;
            main.post(() -> {
                if (text != null) Toast.makeText(this, text, Toast.LENGTH_LONG).show();
                reload();
            });
        });
    }

    private void retryUpload(LocalDb.Item item) {
        Context app = getApplicationContext();
        EXECUTOR.execute(() -> {
            LocalDb.get(app).retryNow(item.externalId);
            SyncScheduler.scheduleNow(app, true);
            main.post(this::reload);
        });
        Toast.makeText(this, "VoiceCAP 업로드를 다시 시도합니다.", Toast.LENGTH_SHORT).show();
    }

    private void showMessageMenu(ConversationStore.Message message) {
        new AlertDialog.Builder(this)
                .setItems(new String[]{"복사", "삭제"}, (dialog, which) -> {
                    if (which == 0) {
                        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("문자", message.body));
                        Toast.makeText(this, "복사했습니다.", Toast.LENGTH_SHORT).show();
                    } else {
                        confirmDelete(message);
                    }
                })
                .show();
    }

    private void confirmDelete(ConversationStore.Message message) {
        new AlertDialog.Builder(this)
                .setMessage("이 문자를 휴대폰에서 삭제할까요? VoiceCAP에 이미 저장된 기록은 지워지지 않습니다.")
                .setNegativeButton("취소", null)
                .setPositiveButton("삭제", (dialog, which) -> {
                    if (!canSend()) {
                        Toast.makeText(this, "기본 문자앱일 때만 삭제할 수 있습니다.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    EXECUTOR.execute(() -> {
                        store.deleteMessage(message.providerUri);
                        main.post(this::reload);
                    });
                })
                .show();
    }

    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return rows.size(); }
        @Override public Object getItem(int position) { return rows.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public int getItemViewType(int position) { return rows.get(position) instanceof String ? 0 : 1; }
        @Override public boolean isEnabled(int position) { return false; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            Object row = rows.get(position);
            if (row instanceof String) return dayDivider((String) row);
            return bubble((Row) row);
        }
    }

    private static LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private View dayDivider(String label) {
        TextView text = new TextView(this);
        text.setText(label);
        text.setTextSize(12);
        text.setTextColor(Ui.SLATE_500);
        text.setGravity(Gravity.CENTER);
        text.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 8));
        return text;
    }

    private View bubble(Row row) {
        ConversationStore.Message message = row.message;
        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setGravity(message.outgoing ? Gravity.END : Gravity.START);
        wrapper.setPadding(message.outgoing ? Ui.dp(this, 48) : 0, Ui.dp(this, 3), message.outgoing ? 0 : Ui.dp(this, 48), Ui.dp(this, 3));

        LinearLayout bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(Ui.dp(this, 12), Ui.dp(this, 8), Ui.dp(this, 12), Ui.dp(this, 8));
        bubble.setBackground(message.outgoing
                ? Ui.roundRect(this, message.failed() ? Color.rgb(254, 226, 226) : Ui.BRAND_500, Color.TRANSPARENT, 16)
                : Ui.roundRect(this, Color.WHITE, Ui.SLATE_200, 16));
        int maxThumb = Ui.dp(this, 200);
        for (Uri image : message.images) {
            ImageView view = new ImageView(this);
            view.setAdjustViewBounds(true);
            view.setMaxWidth(maxThumb);
            view.setMaxHeight(maxThumb);
            view.setScaleType(ImageView.ScaleType.FIT_CENTER);
            view.setContentDescription("사진 크게 보기");
            view.setOnClickListener(v -> startActivity(ImageViewerActivity.intent(this, image)));
            Thumbnails.load(this, image, maxThumb, view);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.bottomMargin = Ui.dp(this, 4);
            bubble.addView(view, params);
        }
        if (!message.body.isEmpty() || message.images.isEmpty()) {
            TextView body = new TextView(this);
            body.setText(message.body.isEmpty() ? "(내용 없음)" : message.body);
            body.setTextSize(15);
            body.setTextColor(message.outgoing && !message.failed() ? Color.WHITE : Ui.SLATE_900);
            body.setTextIsSelectable(false);
            bubble.addView(body);
        }
        bubble.setOnLongClickListener(v -> {
            showMessageMenu(message);
            return true;
        });
        if (message.failed() && !message.mms) bubble.setOnClickListener(v -> resend(message));
        wrapper.addView(bubble, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView meta = new TextView(this);
        meta.setTextSize(11);
        meta.setPadding(Ui.dp(this, 4), Ui.dp(this, 2), Ui.dp(this, 4), 0);
        String time = ConversationLogic.timeLabel(message.date, TimeZone.getDefault());
        if (message.failed()) {
            meta.setText(message.mms ? "전송 실패 · " + time : "전송 실패 · 다시 보내기 · " + time);
            meta.setTextColor(Color.rgb(220, 38, 38));
            if (!message.mms) meta.setOnClickListener(v -> resend(message));
        } else {
            meta.setText(message.sending() ? "보내는 중… · " + time : time);
            meta.setTextColor(Ui.SLATE_400);
        }
        wrapper.addView(meta, wrap());

        // 업무 대상 문자만 배지를 단다 (SKIPPED·행 없음 = 개인 문자, 배지 없음).
        ConversationLogic.Badge badge = row.sync == null ? ConversationLogic.Badge.NONE : ConversationLogic.badge(row.sync.state);
        if (badge != ConversationLogic.Badge.NONE) {
            TextView label = new TextView(this);
            label.setText(ConversationLogic.badgeLabel(badge));
            label.setTextSize(11);
            label.setTextColor(badge == ConversationLogic.Badge.FAILED ? Color.rgb(220, 38, 38) : Ui.SLATE_500);
            label.setPadding(Ui.dp(this, 4), Ui.dp(this, 1), Ui.dp(this, 4), 0);
            if (badge == ConversationLogic.Badge.FAILED) {
                LocalDb.Item item = row.sync;
                label.setOnClickListener(v -> retryUpload(item));
            }
            wrapper.addView(label, wrap());
        }
        return wrapper;
    }
}
