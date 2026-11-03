package com.voicecap.sales;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Handler;
import android.os.Looper;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Serial Port Profile transport. Never retries a partially submitted print job. */
@SuppressLint("MissingPermission")
final class SppPrinter {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final ExecutorService writes = Executors.newSingleThreadExecutor();
    private volatile BluetoothSocket socket;
    private volatile boolean connected;
    private Runnable cancelConnect;

    boolean isConnected() { return connected && socket != null && socket.isConnected(); }

    synchronized void connect(BluetoothDevice device, BlePrinter.Done done) {
        disconnect();
        final BluetoothSocket target;
        try { target = device.createRfcommSocketToServiceRecord(SPP); }
        catch (IOException | RuntimeException e) { done.done(false, "프린터 연결을 준비하지 못했습니다."); return; }
        socket = target;
        AtomicBoolean finished = new AtomicBoolean();
        Runnable cancel = () -> {
            if (finished.compareAndSet(false, true)) {
                close(target);
                done.done(false, "프린터 연결이 취소되었거나 시간이 초과되었습니다.");
            }
        };
        cancelConnect = cancel;
        timer.postDelayed(cancel, 15000);
        new Thread(() -> {
            String error = null;
            try { target.connect(); }
            catch (IOException | RuntimeException e) { error = "프린터에 연결하지 못했습니다. 전원과 블루투스 페어링을 확인해 주세요."; }
            synchronized (SppPrinter.this) {
                if (!finished.compareAndSet(false, true)) { close(target); return; }
                timer.removeCallbacks(cancel);
                cancelConnect = null;
                connected = error == null && socket == target;
                if (!connected) close(target);
                done.done(connected, error);
            }
        }, "voicecap-spp-connect").start();
    }

    synchronized void disconnect() {
        connected = false;
        if (cancelConnect != null) { cancelConnect.run(); cancelConnect = null; }
        close(socket);
        socket = null;
    }

    void send(byte[] data, BlePrinter.Done done) {
        final BluetoothSocket target = socket;
        writes.execute(() -> {
            AtomicBoolean finished = new AtomicBoolean();
            Runnable timeout = () -> {
                if (finished.compareAndSet(false, true)) {
                    fail(target);
                    done.done(false, "전송 시간이 초과되었습니다. 실제 출력 여부를 확인해 주세요.");
                }
            };
            timer.postDelayed(timeout, 25000);
            try {
                if (target == null || target != socket || !isConnected()) throw new IOException();
                OutputStream out = target.getOutputStream();
                for (int at = 0; at < data.length; at += 512) {
                    if (target != socket || finished.get()) throw new IOException();
                    out.write(data, at, Math.min(512, data.length - at));
                }
                out.flush();
                if (finished.compareAndSet(false, true)) done.done(true, null);
            } catch (IOException | RuntimeException e) {
                fail(target);
                if (finished.compareAndSet(false, true))
                    done.done(false, "전송 중 연결이 끊어졌습니다. 실제 출력 여부를 확인해 주세요.");
            } finally { timer.removeCallbacks(timeout); }
        });
    }

    private synchronized void fail(BluetoothSocket target) {
        if (socket == target) connected = false;
        close(target);
    }
    private static void close(BluetoothSocket target) {
        if (target != null) try { target.close(); } catch (IOException ignored) { }
    }
}
