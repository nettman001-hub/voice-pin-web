package com.voicecap.sales;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;

import java.util.UUID;

/**
 * 블루투스 라벨프린터(AbleMark M50 등 Marklife 계열) 보내기만 맡는다. 라벨 그림과 명령 바이트는 웹이 만든다.
 * 서비스 ff00: ff02 쓰기, ff03 알림(허용 신호 [01 n] = n조각 더 보내도 됨). /sell-test에서 M50으로 확인한 방식과 같다.
 * 권한 확인은 MainActivity가 먼저 한다.
 */
@SuppressLint("MissingPermission")
public final class BlePrinter {
    public interface Done { void done(boolean ok, String error); }

    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final String PREFS = "printer";
    private static BlePrinter instance;

    private final Context context;
    private final Object lock = new Object();
    private final HandlerThread thread = new HandlerThread("voicecap-printer");
    private final Handler worker;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private String name = "";
    private String address = "";
    private volatile boolean connected;
    private int mtu = 23;
    private int credits;
    private boolean creditSeen;
    private boolean writePending;
    private Done connectDone;

    private BlePrinter(Context context) {
        this.context = context.getApplicationContext();
        thread.start();
        worker = new Handler(thread.getLooper());
    }

    public static synchronized BlePrinter get(Context context) {
        if (instance == null) instance = new BlePrinter(context);
        return instance;
    }

    public boolean isConnected() { return connected && writeChar != null; }
    public String name() { return name; }
    public String address() { return address; }
    public String lastAddress() { return prefs().getString("address", ""); }

    private SharedPreferences prefs() { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    public void connect(String deviceAddress, Done done) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            done.done(false, "블루투스를 켜 주세요.");
            return;
        }
        disconnect();
        BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(deviceAddress);
        } catch (IllegalArgumentException e) {
            done.done(false, "프린터 주소가 올바르지 않습니다.");
            return;
        }
        synchronized (lock) {
            connectDone = done;
            credits = 0;
            creditSeen = false;
            writePending = false;
        }
        name = device.getName() == null ? "" : device.getName();
        address = deviceAddress;
        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE);
        worker.postDelayed(() -> finishConnect(false, "프린터가 응답하지 않습니다. 프린터 전원을 확인해 주세요."), 15000);
    }

    private void finishConnect(boolean ok, String error) {
        Done done;
        synchronized (lock) {
            done = connectDone;
            connectDone = null;
        }
        if (done == null) return;
        if (ok) prefs().edit().putString("address", address).putString("name", name).apply();
        else disconnect();
        done.done(ok, error);
    }

    public void disconnect() {
        connected = false;
        writeChar = null;
        if (gatt != null) {
            try {
                gatt.disconnect();
                gatt.close();
            } catch (RuntimeException ignored) { }
        }
        gatt = null;
        synchronized (lock) { lock.notifyAll(); }
    }

    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                // 웹(Chrome)과 같이 큰 조각(90바이트)을 보내려면 MTU를 늘린다.
                if (!g.requestMtu(247)) g.discoverServices();
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connected = false;
                writeChar = null;
                synchronized (lock) { lock.notifyAll(); }
                finishConnect(false, "프린터 연결이 끊어졌습니다.");
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int newMtu, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu;
            g.discoverServices();
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            BluetoothGattCharacteristic write = null;
            BluetoothGattCharacteristic notify = null;
            for (BluetoothGattService service : g.getServices()) {
                for (BluetoothGattCharacteristic c : service.getCharacteristics()) {
                    String id = shortId(c.getUuid());
                    int p = c.getProperties();
                    boolean canWrite = (p & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0;
                    boolean canNotify = (p & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0;
                    if ("ff02".equals(id) && canWrite) write = c;
                    if ("ff03".equals(id) && canNotify) notify = c;
                    if (write == null && canWrite) write = c;
                    if (notify == null && canNotify && (write == null || !c.getUuid().equals(write.getUuid()))) notify = c;
                }
            }
            if (write == null) {
                finishConnect(false, "이 기기는 라벨프린터가 아닌 것 같습니다 (쓰기 특성 없음).");
                return;
            }
            writeChar = write;
            if (notify != null) {
                g.setCharacteristicNotification(notify, true);
                BluetoothGattDescriptor d = notify.getDescriptor(CCCD);
                if (d != null) {
                    writeDescriptor(g, d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    return; // onDescriptorWrite에서 연결 완료
                }
            }
            connected = true;
            finishConnect(true, null);
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            connected = true;
            finishConnect(true, null);
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            synchronized (lock) {
                writePending = false;
                lock.notifyAll();
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            // Android 13+는 아래 새 콜백도 부른다. 허용 신호를 두 번 세지 않도록 예전 버전에서만 쓴다.
            if (Build.VERSION.SDK_INT < 33) onNotify(c.getValue());
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) {
            onNotify(value);
        }
    };

    private void onNotify(byte[] value) {
        if (value == null || value.length < 2 || value[0] != 0x01) return;
        synchronized (lock) {
            creditSeen = true;
            credits += value[1] & 0xff;
            lock.notifyAll();
        }
    }

    static String shortId(UUID uuid) {
        return uuid.toString().substring(4, 8).toLowerCase();
    }

    @SuppressWarnings("deprecation")
    private static void writeDescriptor(BluetoothGatt g, BluetoothGattDescriptor d, byte[] value) {
        if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, value);
        else {
            d.setValue(value);
            g.writeDescriptor(d);
        }
    }

    @SuppressWarnings("deprecation")
    private boolean writeChunk(byte[] chunk) {
        BluetoothGatt g = gatt;
        BluetoothGattCharacteristic c = writeChar;
        if (g == null || c == null) return false;
        boolean noResponse = (c.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        int type = noResponse ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
        if (Build.VERSION.SDK_INT >= 33) return g.writeCharacteristic(c, chunk, type) == BluetoothGatt.GATT_SUCCESS;
        c.setWriteType(type);
        c.setValue(chunk);
        return g.writeCharacteristic(c);
    }

    /** 조각으로 나눠 보낸다. 허용 신호를 받은 프린터는 신호만큼만, 아니면 쓰기 완료마다 보낸다. */
    public void send(byte[] data, Done done) {
        worker.post(() -> {
            try {
                if (!isConnected()) throw new IllegalStateException("프린터가 연결되어 있지 않습니다.");
                int size = Math.max(20, Math.min(90, mtu - 3));
                for (int offset = 0; offset < data.length; offset += size) {
                    byte[] chunk = java.util.Arrays.copyOfRange(data, offset, Math.min(data.length, offset + size));
                    synchronized (lock) {
                        if (creditSeen) {
                            long until = System.currentTimeMillis() + 3000;
                            while (credits <= 0 && isConnected() && System.currentTimeMillis() < until)
                                lock.wait(Math.max(1, until - System.currentTimeMillis()));
                            if (credits > 0) credits--;
                        }
                        long until = System.currentTimeMillis() + 2000;
                        while (writePending && isConnected() && System.currentTimeMillis() < until)
                            lock.wait(Math.max(1, until - System.currentTimeMillis()));
                        if (!isConnected()) throw new IllegalStateException("보내는 중에 프린터 연결이 끊어졌습니다.");
                        writePending = true;
                    }
                    boolean ok = false;
                    for (int attempt = 0; attempt < 20 && !ok; attempt++) {
                        ok = writeChunk(chunk);
                        if (!ok) Thread.sleep(15);
                    }
                    if (!ok) {
                        synchronized (lock) { writePending = false; }
                        throw new IllegalStateException("프린터로 보내지 못했습니다.");
                    }
                }
                done.done(true, null);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                done.done(false, "보내기가 멈췄습니다.");
            } catch (RuntimeException e) {
                done.done(false, e.getMessage());
            }
        });
    }
}
