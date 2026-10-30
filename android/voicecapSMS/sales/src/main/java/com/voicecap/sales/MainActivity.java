package com.voicecap.sales;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * "VoiceCAP 판매": [판매] 탭은 voicecap.shop/sell, [관리] 탭은 판매내역 웹 화면.
 * 웹이 라벨을 그리고 명령 바이트를 만들면 window.VoiceCapAndroid로 받아 블루투스로 보낸다.
 * 결과는 window 'voicecap-android' 이벤트(detail = JSON 문자열)로 돌려준다.
 */
@SuppressLint("MissingPermission")
public class MainActivity extends Activity {
    private static final int REQ_CAMERA = 11;
    private static final int REQ_BLUETOOTH = 12;
    private static final int REQ_NOTIFY = 13;
    private static final int REQ_FILE = 14;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView sellView;
    private WebView manageView;
    private WebView current;
    private Button sellTab;
    private Button manageTab;
    private PermissionRequest pendingCamera;
    private Runnable pendingBluetooth;
    private Runnable bluetoothDenied;
    private ValueCallback<Uri[]> pendingFile;
    private BlePrinter printer;
    /** 떠 있는 웹 alert/confirm 대화상자. 화면이 없어질 때 닫아서 각 JsResult가 "취소"로 한 번 답하게 한다. */
    private final java.util.Set<AlertDialog> jsDialogs = new java.util.HashSet<>();

    private String base() { return BuildConfig.VOICECAP_WEB_BASE_URL; }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        printer = BlePrinter.get(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        FrameLayout pages = new FrameLayout(this);
        root.addView(pages, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        sellView = createWebView();
        manageView = createWebView();
        pages.addView(sellView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        pages.addView(manageView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setBackgroundColor(Color.rgb(242, 246, 250));
        sellTab = tabButton(getString(R.string.tab_sell));
        manageTab = tabButton(getString(R.string.tab_manage));
        tabs.addView(sellTab, new LinearLayout.LayoutParams(0, dp(52), 1f));
        tabs.addView(manageTab, new LinearLayout.LayoutParams(0, dp(52), 1f));
        root.addView(tabs, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        sellTab.setOnClickListener(v -> show(sellView));
        manageTab.setOnClickListener(v -> show(manageView));

        applySystemBarInsets(root);
        setContentView(root);
        sellView.loadUrl(base() + "/sell");
        show(sellView);
        // targetSdk 36에서는 onBackPressed가 불리지 않는다(예측 뒤로 가기).
        if (Build.VERSION.SDK_INT >= 33)
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private Button tabButton(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setBackgroundColor(Color.TRANSPARENT);
        b.setGravity(Gravity.CENTER);
        return b;
    }

    private void show(WebView view) {
        if (view == manageView && manageView.getUrl() == null) manageView.loadUrl(base() + "/sales");
        current = view;
        sellView.setVisibility(view == sellView ? View.VISIBLE : View.GONE);
        manageView.setVisibility(view == manageView ? View.VISIBLE : View.GONE);
        styleTab(sellTab, view == sellView);
        styleTab(manageTab, view == manageView);
    }

    private void styleTab(Button b, boolean active) {
        b.setTextColor(active ? Color.rgb(8, 116, 202) : Color.rgb(100, 116, 139));
        b.setTypeface(null, active ? Typeface.BOLD : Typeface.NORMAL);
    }

    /** Android 15+는 화면이 시스템 바 아래까지 그려진다. 바 높이만큼 비켜 준다. */
    private static void applySystemBarInsets(View root) {
        if (Build.VERSION.SDK_INT < 35) return;
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(android.view.WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return android.view.WindowInsets.CONSUMED;
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView view = new WebView(this);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " VoiceCAPSales/" + BuildConfig.VERSION_NAME);
        view.addJavascriptInterface(new Bridge(view), "VoiceCapAndroid");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri url = request.getUrl();
                SalesNavigationPolicy.Decision decision = SalesNavigationPolicy.decide(
                        url.toString(), base(), request.isForMainFrame());
                if (decision == SalesNavigationPolicy.Decision.IN_APP) return false;
                // 외부 웹 링크만 브라우저로 연다. iframe이나 앱 전용 스킴은 외부 앱을 실행하지 않는다.
                if (decision == SalesNavigationPolicy.Decision.EXTERNAL) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, url));
                    } catch (RuntimeException ignored) { }
                }
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            // 웹의 alert()/confirm()은 이 함수를 만들어 두지 않으면 화면 없이 무시(confirm은 늘 "취소")된다.
            @Override
            public boolean onJsAlert(WebView v, String url, String message, JsResult result) {
                return showJsDialog(message, false, result);
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, JsResult result) {
                return showJsDialog(message, true, result);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                main.post(() -> handleMediaPermission(request));
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFile != null) pendingFile.onReceiveValue(null);
                pendingFile = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (RuntimeException e) {
                    pendingFile = null;
                    return false;
                }
                return true;
            }
        });
        return view;
    }

    /** 웹의 alert/confirm을 앱 대화상자로 보여 준다. 화면을 닫거나 바깥을 누르면 "취소"로 돌려준다. */
    private boolean showJsDialog(String message, boolean confirm, JsResult result) {
        if (isFinishing()) {
            result.cancel();
            return true;
        }
        // JsResult는 정확히 한 번만 답해야 한다. 버튼·취소·닫힘(화면 종료 포함) 중 먼저 온 것 하나만 쓴다.
        final boolean[] answered = {false};
        AlertDialog.Builder builder = new AlertDialog.Builder(this).setMessage(message);
        builder.setPositiveButton("확인", (d, w) -> {
            if (!answered[0]) { answered[0] = true; result.confirm(); }
        });
        if (confirm) builder.setNegativeButton("취소", (d, w) -> {
            if (!answered[0]) { answered[0] = true; result.cancel(); }
        });
        final AlertDialog[] shown = {null};
        builder.setOnDismissListener(d -> {
            jsDialogs.remove(shown[0]);
            if (!answered[0]) { answered[0] = true; result.cancel(); }
        });
        try {
            shown[0] = builder.create();
            jsDialogs.add(shown[0]);
            shown[0].show();
        } catch (RuntimeException e) {
            jsDialogs.remove(shown[0]);
            // 화면이 막 닫히는 중이라 대화상자를 띄우지 못하면 "취소"로 답한다.
            if (!answered[0]) { answered[0] = true; result.cancel(); }
        }
        return true;
    }

    /** 판매 사진은 앞카메라만 쓴다. 마이크 요청은 허용하지 않는다. */
    private void handleMediaPermission(PermissionRequest request) {
        boolean video = false;
        for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) video = true;
        if (!video) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        if (pendingCamera != null) pendingCamera.deny();
        pendingCamera = request;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
    }

    private String[] bluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= 31)
            return new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT};
        return new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
    }

    private boolean hasAll(String[] permissions) {
        for (String p : permissions) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private void withBluetooth(Runnable action, Runnable denied) {
        String[] needed = bluetoothPermissions();
        if (hasAll(needed)) {
            action.run();
            return;
        }
        if (bluetoothDenied != null) bluetoothDenied.run();
        pendingBluetooth = action;
        bluetoothDenied = denied;
        requestPermissions(needed, REQ_BLUETOOTH);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        boolean granted = results.length > 0;
        for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) granted = false;
        if (requestCode == REQ_CAMERA && pendingCamera != null) {
            if (granted) pendingCamera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingCamera.deny();
            pendingCamera = null;
        } else if (requestCode == REQ_BLUETOOTH) {
            Runnable action = granted ? pendingBluetooth : bluetoothDenied;
            pendingBluetooth = null;
            bluetoothDenied = null;
            if (action != null) action.run();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && pendingFile != null) {
            pendingFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFile = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** 뒤로: 웹 뒤로 → 관리 탭이면 판매 탭 → 판매 탭이면 앱을 닫지 않고 뒤로 보낸다(판매·프린터 연결 유지). */
    private void handleBack() {
        if (current != null && current.canGoBack()) current.goBack();
        else if (current == manageView) show(sellView);
        else moveTaskToBack(true);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onDestroy() {
        SellingService.stop(this);
        printer.disconnect();
        // 닫힘 처리에서 각 대화상자의 JsResult가 "취소"로 답한다(웹뷰를 없애기 전에).
        for (AlertDialog dialog : new java.util.ArrayList<>(jsDialogs)) dialog.dismiss();
        jsDialogs.clear();
        sellView.destroy();
        manageView.destroy();
        super.onDestroy();
    }

    private static void emit(WebView view, JSONObject detail) {
        String js = "window.dispatchEvent(new CustomEvent('voicecap-android',{detail:" + JSONObject.quote(detail.toString()) + "}))";
        view.post(() -> view.evaluateJavascript(js, null));
    }

    private static JSONObject event(String type, String requestId, boolean ok, String error) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            if (requestId != null) o.put("requestId", requestId);
            o.put("ok", ok);
            if (error != null) o.put("error", error);
        } catch (JSONException ignored) { }
        return o;
    }

    /** 근처 라벨프린터를 찾아 목록으로 보여 준다. 이름 있는 기기만, 이름이 M50/Marklife 계열이면 위로. */
    private void pickPrinter(WebView view, String requestId) {
        BluetoothAdapter adapter = printer.adapter();
        if (adapter == null || !adapter.isEnabled()) {
            emit(view, event("printer-connected", requestId, false, "블루투스를 켜 주세요."));
            return;
        }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            emit(view, event("printer-connected", requestId, false, "이 폰은 블루투스 기기를 찾을 수 없습니다."));
            return;
        }
        List<BluetoothDevice> devices = new ArrayList<>();
        ArrayAdapter<String> names = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, new ArrayList<>());
        boolean[] finished = {false};
        ScanCallback scan = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice d = result.getDevice();
                String name = d.getName();
                if (name == null || name.isEmpty()) return;
                main.post(() -> {
                    for (BluetoothDevice known : devices) if (known.getAddress().equals(d.getAddress())) return;
                    boolean likely = name.toUpperCase().matches(".*(M50|MARKLIFE|ABLE|P50|D30|L13|PRINT).*");
                    int at = likely ? 0 : devices.size();
                    devices.add(at, d);
                    names.insert(name, at);
                });
            }
        };
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(getString(R.string.printer_pick_title) + " · " + getString(R.string.printer_searching))
                .setAdapter(names, (d, which) -> {
                    finished[0] = true;
                    stopScan(scanner, scan);
                    BluetoothDevice device = devices.get(which);
                    printer.connect(device.getAddress(), (ok, error) ->
                            emit(view, printerEvent("printer-connected", requestId, ok, error)));
                })
                .setNegativeButton(R.string.cancel, (d, w) -> { })
                .setOnDismissListener(d -> {
                    stopScan(scanner, scan);
                    if (!finished[0]) emit(view, event("printer-connected", requestId, false, "프린터를 고르지 않았습니다."));
                })
                .create();
        dialog.show();
        try {
            scanner.startScan(scan);
        } catch (RuntimeException e) {
            dialog.dismiss();
            return;
        }
        main.postDelayed(() -> stopScan(scanner, scan), 20000);
    }

    private static void stopScan(BluetoothLeScanner scanner, ScanCallback scan) {
        try {
            scanner.stopScan(scan);
        } catch (RuntimeException ignored) { }
    }

    private JSONObject printerEvent(String type, String requestId, boolean ok, String error) {
        JSONObject o = event(type, requestId, ok, error);
        try {
            o.put("name", printer.name());
        } catch (JSONException ignored) { }
        return o;
    }

    /** CSV 등 파일을 다운로드 폴더(VoiceCAP)에 저장한다. Android 9 이하는 앱 전용 다운로드 폴더. */
    private Uri saveDownload(String fileName, String mime, byte[] bytes) throws IOException {
        String safe = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/VoiceCAP");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("다운로드 폴더에 저장하지 못했습니다.");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("다운로드 폴더에 저장하지 못했습니다.");
                out.write(bytes);
            }
            return uri;
        }
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) throw new IOException("저장할 곳이 없습니다.");
        File file = new File(dir, safe);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return Uri.fromFile(file);
    }

    /** 웹에서 부르는 함수. 모두 문자열만 주고받고, 오래 걸리는 일은 이벤트로 결과를 준다. */
    private final class Bridge {
        private final WebView view;

        Bridge(WebView view) { this.view = view; }

        @JavascriptInterface
        public String info() {
            JSONObject o = new JSONObject();
            try {
                o.put("app", "sales");
                o.put("version", BuildConfig.VERSION_NAME);
            } catch (JSONException ignored) { }
            return o.toString();
        }

        /** [관리] 탭의 판매 중 띠에서 [판매] 탭으로 바로 간다. */
        @JavascriptInterface
        public void showSell() {
            main.post(() -> show(sellView));
        }

        @JavascriptInterface
        public String printerState() {
            JSONObject o = new JSONObject();
            try {
                o.put("connected", printer.isConnected());
                o.put("name", printer.name());
                o.put("saved", !printer.lastAddress().isEmpty());
            } catch (JSONException ignored) { }
            return o.toString();
        }

        @JavascriptInterface
        public void printerPick(String requestId) {
            main.post(() -> withBluetooth(() -> pickPrinter(view, requestId),
                    () -> emit(view, event("printer-connected", requestId, false, "근처 기기(블루투스) 권한을 허용해 주세요."))));
        }

        @JavascriptInterface
        public void printerConnectLast(String requestId) {
            String address = printer.lastAddress();
            if (address.isEmpty()) {
                emit(view, event("printer-connected", requestId, false, "저장된 프린터가 없습니다."));
                return;
            }
            main.post(() -> withBluetooth(() -> printer.connect(address, (ok, error) ->
                            emit(view, printerEvent("printer-connected", requestId, ok, error))),
                    () -> emit(view, event("printer-connected", requestId, false, "근처 기기(블루투스) 권한을 허용해 주세요."))));
        }

        @JavascriptInterface
        public void printerSend(String requestId, String base64) {
            byte[] data;
            try {
                data = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                emit(view, event("printer-sent", requestId, false, "보낼 내용이 올바르지 않습니다."));
                return;
            }
            printer.send(data, (ok, error) -> emit(view, event("printer-sent", requestId, ok, error)));
        }

        @JavascriptInterface
        public void printerDisconnect() { printer.disconnect(); }

        @JavascriptInterface
        public void saveFile(String requestId, String fileName, String mime, String base64) {
            try {
                Uri uri = saveDownload(fileName, mime, Base64.decode(base64, Base64.DEFAULT));
                JSONObject o = event("file-saved", requestId, true, null);
                o.put("uri", uri.toString());
                emit(view, o);
            } catch (IOException | IllegalArgumentException | JSONException e) {
                emit(view, event("file-saved", requestId, false, e.getMessage()));
            }
        }

        @JavascriptInterface
        public void shareFile(String fileName, String mime, String base64) {
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return;
            }
            Intent send = new Intent(Intent.ACTION_SEND).setType(mime);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    send.putExtra(Intent.EXTRA_STREAM, saveDownload(fileName, mime, bytes));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else {
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
                }
                send.putExtra(Intent.EXTRA_SUBJECT, fileName);
                main.post(() -> startActivity(Intent.createChooser(send, fileName)));
            } catch (IOException | RuntimeException ignored) { }
        }

        @JavascriptInterface
        public void selling(boolean on) {
            main.post(() -> {
                if (!on) {
                    SellingService.stop(MainActivity.this);
                    return;
                }
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
                // Android 14+의 connectedDevice 서비스는 블루투스 연결 권한이 있어야 시작된다.
                if (Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED)
                    SellingService.start(MainActivity.this);
            });
        }
    }
}
