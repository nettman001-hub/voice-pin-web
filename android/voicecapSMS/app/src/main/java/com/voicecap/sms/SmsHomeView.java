package com.voicecap.sms;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Intent;
import android.database.ContentObserver;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 문자연동 탭(기본 탭). 상단 바: 연결 상태 점(초록/회색) + 미동기화 건수 + ✏ 새 문자 + ⚙ 설정.
 * 그 아래 경고 띠(기본 문자앱·알림 권한·연락처 선택 권한), 검색, 대화 목록(50개씩).
 * 업무 고객 대화에는 "VoiceCAP", 차단 번호 대화는 숨기거나(기본) "차단됨"으로 표시한다.
 */
@SuppressLint("ViewConstructor") // 코드로만 만든다 (XML 레이아웃 없음).
final class SmsHomeView extends LinearLayout {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final String HIDE_BLOCKED = "hide_blocked_threads";
    private static final String CONTACTS_CARD_DISMISSED = "contacts_card_dismissed";
    private static final int SEARCH_LIMIT = 300;

    private final MainActivity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ConversationStore store;
    private final GradientDrawable dot = new GradientDrawable();
    private final TextView connection;
    private final TextView unsynced;
    private final LinearLayout roleBanner;
    private final LinearLayout notificationBanner;
    private final LinearLayout contactsBanner;
    private final EditText search;
    private final TextView blockedToggle;
    private final TextView empty;
    private final List<ConversationStore.Conversation> shown = new ArrayList<>();
    private final ThreadAdapter adapter = new ThreadAdapter();
    private final ContentObserver observer;

    /** 다시 읽을 때마다 올린다. 늦게 끝난 이전 읽기 결과는 버린다. */
    private int generation;
    private int rawOffset;
    private boolean exhausted;
    private boolean loading;
    private Map<Long, Integer> unreadCounts;
    private boolean observing;

    SmsHomeView(MainActivity activity) {
        super(activity);
        this.activity = activity;
        this.store = new ConversationStore(activity);
        setOrientation(VERTICAL);
        setBackgroundColor(Ui.SLATE_50);

        LinearLayout bar = new LinearLayout(activity);
        bar.setOrientation(HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(Ui.dp(activity, 18), Ui.dp(activity, 10), Ui.dp(activity, 6), Ui.dp(activity, 10));
        bar.setBackgroundColor(Color.WHITE);

        dot.setShape(GradientDrawable.OVAL);
        View dotView = new View(activity);
        dotView.setBackground(dot);
        LayoutParams dotParams = new LayoutParams(Ui.dp(activity, 10), Ui.dp(activity, 10));
        dotParams.rightMargin = Ui.dp(activity, 8);
        bar.addView(dotView, dotParams);

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(VERTICAL);
        connection = Ui.title(activity, "", 15);
        unsynced = new TextView(activity);
        unsynced.setTextSize(12);
        unsynced.setTextColor(Ui.SLATE_500);
        copy.addView(connection);
        copy.addView(unsynced);
        bar.addView(copy, new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        bar.addView(barIcon("✏", "새 문자", v -> activity.startActivity(ComposeActivity.intent(activity, null, null))),
                new LayoutParams(Ui.dp(activity, 48), Ui.dp(activity, 48)));
        bar.addView(barIcon("⚙", "문자 연동 설정", v -> activity.startActivity(new Intent(activity, SettingsActivity.class))),
                new LayoutParams(Ui.dp(activity, 48), Ui.dp(activity, 48)));
        addView(bar, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout header = new LinearLayout(activity);
        header.setOrientation(VERTICAL);
        header.setPadding(Ui.dp(activity, 12), Ui.dp(activity, 10), Ui.dp(activity, 12), 0);

        roleBanner = Ui.banner(activity);
        roleBanner.addView(Ui.title(activity, "VoiceCAP이 기본 문자앱이 아닙니다", 15));
        roleBanner.addView(Ui.body(activity, "받은 문자 저장, 새 문자 알림, 답장과 웹 발송이 멈춰 있고 문자를 보낼 수 없습니다."));
        Button role = Ui.button(activity, "기본 문자앱으로 다시 설정", true);
        role.setOnClickListener(v -> activity.requestDefaultSmsApp());
        roleBanner.addView(role);
        header.addView(roleBanner);

        notificationBanner = Ui.banner(activity);
        notificationBanner.addView(Ui.title(activity, "알림 권한이 꺼져 있습니다", 15));
        notificationBanner.addView(Ui.body(activity, "새 문자가 와도 알림이 표시되지 않습니다."));
        Button notify = Ui.button(activity, "알림 허용", true);
        notify.setOnClickListener(v -> activity.requestNotificationPermission());
        notificationBanner.addView(notify);
        header.addView(notificationBanner);

        contactsBanner = Ui.card(activity);
        contactsBanner.addView(Ui.title(activity, "연락처 이름으로 보기 (선택)", 15));
        contactsBanner.addView(Ui.body(activity, "허용하면 번호 대신 연락처 이름을 보여 줍니다. 연락처는 서버로 보내지 않습니다."));
        Button allow = Ui.button(activity, "연락처 허용", true);
        allow.setOnClickListener(v -> activity.requestContactsPermission());
        contactsBanner.addView(allow);
        Button later = Ui.button(activity, "괜찮아요", false);
        later.setOnClickListener(v -> {
            BridgePreferences.get(activity).edit().putBoolean(CONTACTS_CARD_DISMISSED, true).apply();
            contactsBanner.setVisibility(GONE);
        });
        contactsBanner.addView(later);
        header.addView(contactsBanner);

        LinearLayout searchRow = new LinearLayout(activity);
        searchRow.setOrientation(HORIZONTAL);
        searchRow.setGravity(Gravity.CENTER_VERTICAL);
        search = new EditText(activity);
        search.setHint("🔍 이름·번호·내용 검색");
        search.setTextSize(14);
        search.setSingleLine(true);
        search.setBackground(Ui.roundRect(activity, Color.WHITE, Ui.SLATE_200, 20));
        search.setPadding(Ui.dp(activity, 14), Ui.dp(activity, 8), Ui.dp(activity, 14), Ui.dp(activity, 8));
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable s) {
                main.removeCallbacks(reloadTask);
                main.postDelayed(reloadTask, 300);
            }
        });
        searchRow.addView(search, new LayoutParams(0, Ui.dp(activity, 42), 1f));
        blockedToggle = new TextView(activity);
        blockedToggle.setTextSize(12);
        blockedToggle.setTextColor(Ui.SLATE_700);
        blockedToggle.setGravity(Gravity.CENTER);
        blockedToggle.setPadding(Ui.dp(activity, 10), 0, Ui.dp(activity, 4), 0);
        blockedToggle.setOnClickListener(v -> {
            BridgePreferences.get(activity).edit().putBoolean(HIDE_BLOCKED, !hideBlocked()).apply();
            updateBlockedToggle();
            reload();
        });
        searchRow.addView(blockedToggle, new LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(activity, 42)));
        LayoutParams searchParams = new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        searchParams.bottomMargin = Ui.dp(activity, 6);
        header.addView(searchRow, searchParams);
        updateBlockedToggle();

        ListView list = new ListView(activity);
        list.setDivider(null);
        list.addHeaderView(header, null, false);
        empty = Ui.body(activity, "");
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(Ui.dp(activity, 24), Ui.dp(activity, 32), Ui.dp(activity, 24), Ui.dp(activity, 32));
        list.addFooterView(empty, null, false);
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> {
            Object item = parent.getItemAtPosition(position);
            if (item instanceof ConversationStore.Conversation) open((ConversationStore.Conversation) item);
        });
        list.setOnItemLongClickListener((parent, view, position, id) -> {
            Object item = parent.getItemAtPosition(position);
            if (item instanceof ConversationStore.Conversation) confirmDelete((ConversationStore.Conversation) item);
            return true;
        });
        list.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override public void onScrollStateChanged(AbsListView view, int scrollState) { }
            @Override public void onScroll(AbsListView view, int first, int visible, int total) {
                if (first + visible >= total - 5) loadMore();
            }
        });
        addView(list, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        observer = new ContentObserver(main) {
            @Override public void onChange(boolean selfChange) {
                main.removeCallbacks(reloadTask);
                main.postDelayed(reloadTask, 600);
            }
        };
    }

    private TextView barIcon(String icon, String description, OnClickListener listener) {
        TextView view = new TextView(activity);
        view.setText(icon);
        view.setTextSize(22);
        view.setTextColor(Ui.SLATE_700);
        view.setGravity(Gravity.CENTER);
        view.setContentDescription(description);
        view.setOnClickListener(listener);
        return view;
    }

    private final Runnable reloadTask = this::reload;

    private boolean hideBlocked() {
        return BridgePreferences.get(activity).getBoolean(HIDE_BLOCKED, true);
    }

    private void updateBlockedToggle() {
        blockedToggle.setText(hideBlocked() ? "차단 숨김 ✓" : "차단 표시");
    }

    void refresh() {
        boolean configured = BridgePreferences.configured(activity);
        boolean consent = BridgePreferences.hasDataTransferConsent(activity);
        boolean defaultApp = SmsRoleUtils.isDefaultSmsApp(activity);
        boolean connected = configured && consent && defaultApp;
        dot.setColor(connected ? Ui.EMERALD_500 : Ui.SLATE_400);
        connection.setText(connected ? "VoiceCAP 연결됨" : !configured ? "웹앱과 연결 안 됨" : !consent ? "전송 동의 필요" : "기본 문자앱 아님");
        roleBanner.setVisibility(defaultApp && SmsRoleUtils.hasSmsPermissions(activity) ? GONE : VISIBLE);
        notificationBanner.setVisibility(SmsRoleUtils.needsNotificationPermission(activity) ? VISIBLE : GONE);
        contactsBanner.setVisibility(ConversationStore.canReadContacts(activity)
                || BridgePreferences.get(activity).getBoolean(CONTACTS_CARD_DISMISSED, false) ? GONE : VISIBLE);
        if (!observing) {
            try {
                activity.getContentResolver().registerContentObserver(Uri.parse("content://mms-sms/"), true, observer);
                observing = true;
            } catch (RuntimeException ignored) { }
        }
        reload();
    }

    /** 화면을 떠날 때 문자함 감시를 멈춘다. */
    void stop() {
        if (observing) activity.getContentResolver().unregisterContentObserver(observer);
        observing = false;
        main.removeCallbacks(reloadTask);
    }

    /** 연락처 권한이 바뀌면 이름을 다시 읽는다 (캐시는 reload가 작업 스레드에서 비운다). */
    void onContactsPermissionChanged() {
        refresh();
    }

    /** 처음부터 다시 읽는다 (검색어가 있으면 검색 결과). */
    private void reload() {
        int current = ++generation;
        rawOffset = 0;
        exhausted = false;
        loading = true;
        String query = search.getText().toString().trim();
        boolean hide = hideBlocked();
        EXECUTOR.execute(() -> {
            int count = LocalDb.get(activity).unsyncedCount();
            main.post(() -> unsynced.setText(count == 0 ? "미동기화 없음" : "미동기화 " + count + "건"));
            store.clearCaches();
            Map<Long, Integer> unread = store.unreadCounts();
            List<ConversationStore.Conversation> page = new ArrayList<>();
            int offset = 0;
            boolean done = false;
            if (query.isEmpty()) {
                // 차단 대화를 숨기면 한 페이지가 비어 보일 수 있으므로 채워질 때까지 다음 50개를 더 읽는다.
                while (page.isEmpty() && !done) {
                    List<ConversationStore.Conversation> raw = store.threads(offset, unread);
                    offset += raw.size();
                    done = raw.size() < ConversationStore.PAGE_SIZE;
                    for (ConversationStore.Conversation thread : raw) if (!hide || !thread.blocked) page.add(thread);
                }
            } else {
                Set<Long> bodyMatches = store.threadsWithBody(query);
                while (!done && page.size() < SEARCH_LIMIT) {
                    List<ConversationStore.Conversation> raw = store.threads(offset, unread);
                    offset += raw.size();
                    done = raw.size() < ConversationStore.PAGE_SIZE;
                    for (ConversationStore.Conversation thread : raw) {
                        if (hide && thread.blocked) continue;
                        boolean match = bodyMatches.contains(thread.id);
                        for (String address : thread.addresses) match |= ConversationLogic.matchesSearch(query, thread.name, address, thread.snippet);
                        if (match) page.add(thread);
                    }
                }
                done = true;
            }
            int finalOffset = offset;
            boolean finalDone = done;
            main.post(() -> {
                if (current != generation) return;
                unreadCounts = unread;
                rawOffset = finalOffset;
                exhausted = finalDone;
                loading = false;
                shown.clear();
                shown.addAll(page);
                adapter.notifyDataSetChanged();
                updateEmpty(query);
            });
        });
    }

    /** 목록 끝에 가까워지면 다음 50개. */
    private void loadMore() {
        if (loading || exhausted || unreadCounts == null) return;
        loading = true;
        int current = generation;
        int offset = rawOffset;
        boolean hide = hideBlocked();
        Map<Long, Integer> unread = unreadCounts;
        EXECUTOR.execute(() -> {
            List<ConversationStore.Conversation> raw = store.threads(offset, unread);
            List<ConversationStore.Conversation> page = new ArrayList<>();
            for (ConversationStore.Conversation thread : raw) if (!hide || !thread.blocked) page.add(thread);
            main.post(() -> {
                if (current != generation) return;
                rawOffset = offset + raw.size();
                exhausted = raw.size() < ConversationStore.PAGE_SIZE;
                loading = false;
                shown.addAll(page);
                adapter.notifyDataSetChanged();
                updateEmpty("");
            });
        });
    }

    private void updateEmpty(String query) {
        if (!shown.isEmpty()) {
            empty.setVisibility(GONE);
            empty.setText("");
            return;
        }
        empty.setVisibility(VISIBLE);
        if (!query.isEmpty()) empty.setText("\"" + query + "\"에 맞는 대화가 없습니다.");
        else if (!SmsRoleUtils.hasSmsPermissions(activity)) empty.setText("기본 문자앱으로 설정하면 휴대폰의 문자 대화가 여기에 보입니다.");
        else empty.setText("대화가 없습니다. ✏ 버튼으로 새 문자를 보낼 수 있습니다.");
    }

    private void open(ConversationStore.Conversation thread) {
        activity.startActivity(ChatActivity.intent(activity, thread.id, thread.address()));
    }

    private void confirmDelete(ConversationStore.Conversation thread) {
        new AlertDialog.Builder(activity)
                .setTitle("대화 삭제")
                .setMessage(thread.title() + " 님과의 대화를 휴대폰에서 모두 삭제할까요? VoiceCAP에 이미 저장된 기록은 지워지지 않습니다.")
                .setNegativeButton("취소", null)
                .setPositiveButton("삭제", (dialog, which) -> {
                    if (!SmsRoleUtils.isDefaultSmsApp(activity)) {
                        Toast.makeText(activity, "기본 문자앱일 때만 삭제할 수 있습니다.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    EXECUTOR.execute(() -> {
                        boolean deleted = store.deleteThread(thread.id);
                        main.post(() -> {
                            if (!deleted) Toast.makeText(activity, "대화를 삭제하지 못했습니다.", Toast.LENGTH_SHORT).show();
                            reload();
                        });
                    });
                })
                .show();
    }

    private final class ThreadAdapter extends BaseAdapter {
        @Override public int getCount() { return shown.size(); }
        @Override public Object getItem(int position) { return shown.get(position); }
        @Override public long getItemId(int position) { return shown.get(position).id; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            return row(shown.get(position));
        }
    }

    private View row(ConversationStore.Conversation thread) {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(Ui.dp(activity, 16), Ui.dp(activity, 12), Ui.dp(activity, 16), Ui.dp(activity, 12));
        row.setBackgroundColor(Color.WHITE);
        row.setAlpha(thread.blocked ? 0.55f : 1f);

        TextView avatar = new TextView(activity);
        String title = thread.title();
        // 이름이 없으면(번호만) 첫 숫자 대신 사람 모양을 쓴다.
        boolean named = thread.name != null && !thread.name.isEmpty();
        avatar.setText(named ? title.substring(0, 1) : "👤");
        avatar.setTextColor(thread.business ? Color.WHITE : Ui.SLATE_700);
        avatar.setTextSize(16);
        avatar.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        avatar.setGravity(Gravity.CENTER);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(thread.business ? Ui.BRAND_500 : Ui.SLATE_200);
        avatar.setBackground(circle);
        LayoutParams avatarParams = new LayoutParams(Ui.dp(activity, 44), Ui.dp(activity, 44));
        avatarParams.rightMargin = Ui.dp(activity, 12);
        row.addView(avatar, avatarParams);

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(VERTICAL);
        LinearLayout titleRow = new LinearLayout(activity);
        titleRow.setOrientation(HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView name = new TextView(activity);
        name.setText(title);
        name.setTextSize(15);
        name.setTextColor(Ui.SLATE_900);
        name.setSingleLine(true);
        name.setTypeface(Typeface.DEFAULT, thread.unread > 0 ? Typeface.BOLD : Typeface.NORMAL);
        titleRow.addView(name, new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (thread.business) titleRow.addView(chip("VoiceCAP", Ui.BRAND_50, Ui.BRAND_800));
        if (thread.blocked) titleRow.addView(chip("차단됨", Ui.SLATE_100, Ui.SLATE_500));
        TextView time = new TextView(activity);
        time.setText(ConversationLogic.listTimeLabel(thread.date, System.currentTimeMillis(), TimeZone.getDefault()));
        time.setTextSize(12);
        time.setTextColor(Ui.SLATE_400);
        time.setPadding(Ui.dp(activity, 8), 0, 0, 0);
        titleRow.addView(time);
        copy.addView(titleRow);

        LinearLayout snippetRow = new LinearLayout(activity);
        snippetRow.setOrientation(HORIZONTAL);
        snippetRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView snippet = new TextView(activity);
        snippet.setText(thread.snippet.isEmpty() ? "(사진)" : thread.snippet.replace('\n', ' '));
        snippet.setTextSize(13);
        snippet.setTextColor(thread.unread > 0 ? Ui.SLATE_700 : Ui.SLATE_500);
        snippet.setSingleLine(true);
        snippet.setEllipsize(android.text.TextUtils.TruncateAt.END);
        snippetRow.addView(snippet, new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (thread.unread > 0) {
            TextView badge = new TextView(activity);
            badge.setText(thread.unread > 99 ? "99+" : String.valueOf(thread.unread));
            badge.setTextSize(11);
            badge.setTextColor(Color.WHITE);
            badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            badge.setGravity(Gravity.CENTER);
            badge.setMinWidth(Ui.dp(activity, 20));
            badge.setPadding(Ui.dp(activity, 6), Ui.dp(activity, 1), Ui.dp(activity, 6), Ui.dp(activity, 1));
            badge.setBackground(Ui.roundRect(activity, Color.rgb(239, 68, 68), Color.TRANSPARENT, 10));
            LayoutParams badgeParams = new LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            badgeParams.leftMargin = Ui.dp(activity, 8);
            snippetRow.addView(badge, badgeParams);
        }
        copy.addView(snippetRow);
        row.addView(copy, new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        LinearLayout wrapper = new LinearLayout(activity);
        wrapper.setOrientation(VERTICAL);
        wrapper.addView(row);
        View divider = new View(activity);
        divider.setBackgroundColor(Ui.SLATE_100);
        wrapper.addView(divider, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        return wrapper;
    }

    private TextView chip(String text, int fill, int color) {
        TextView chip = new TextView(activity);
        chip.setText(text);
        chip.setTextSize(10);
        chip.setTextColor(color);
        chip.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        chip.setPadding(Ui.dp(activity, 6), Ui.dp(activity, 1), Ui.dp(activity, 6), Ui.dp(activity, 1));
        chip.setBackground(Ui.roundRect(activity, fill, Color.TRANSPARENT, 8));
        LayoutParams params = new LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.leftMargin = Ui.dp(activity, 6);
        chip.setLayoutParams(params);
        return chip;
    }
}
