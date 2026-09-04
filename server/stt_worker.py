# -*- coding: utf-8 -*-
"""
VoiceCAP Offline STT Worker (faster-whisper)
실시간 한국어 라이브 방송 음성인식 전용 워커 프로세스.
표준 입출력(stdin/stdout)을 통한 JSON-RPC 통신으로 Node.js 브리지 서버와 연동됩니다.
"""

import sys
import os
import json
import base64
import time
import math
import traceback
import numpy as np

# Windows UTF-8 입출력 강제 설정
if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

try:
    import faster_whisper
except ImportError:
    faster_whisper = None

# ---------------------------------------------------------------------------
# 전역 설정 및 상태
# ---------------------------------------------------------------------------
SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # 16-bit PCM
BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE  # 32000 bytes/sec
SILENCE_RMS_THRESHOLD = 0.012
MIN_SPEECH_DURATION_SEC = 0.6
MIN_SILENCE_DURATION_SEC = 0.5
MAX_SPEECH_BUFFER_SEC = 3.5

current_model = None
current_model_name = ""
current_device = "cpu"
current_compute_type = "int8"
worker_state = "IDLE"  # IDLE | LOADING | READY | LISTENING | ERROR

current_session_id = ""
current_generation = 0
current_initial_prompt = ""

audio_buffer = bytearray()
speech_detected = False
silence_samples_count = 0
speech_samples_count = 0


def send_event(event_dict):
    """JSON-RPC 이벤트 한 줄 출력"""
    try:
        sys.stdout.write(json.dumps(event_dict, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"[stt_worker] send_event 오류: {e}\n")


def calculate_rms(pcm_bytes):
    """PCM16 바이트 배열의 RMS(음압 레벨) 계산"""
    if not pcm_bytes or len(pcm_bytes) < 2:
        return 0.0
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    if len(samples) == 0:
        return 0.0
    # 계산 가속을 위해 8개 단위 서브샘플링
    sub_samples = samples[::8].astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(sub_samples ** 2))) if len(sub_samples) > 0 else 0.0


def do_load_model(model_name="base", device="cpu", compute_type="int8"):
    global current_model, current_model_name, current_device, current_compute_type, worker_state

    if faster_whisper is None:
        worker_state = "ERROR"
        send_event({
            "event": "error",
            "message": "faster-whisper 패키지가 설치되어 있지 않습니다."
        })
        return False

    worker_state = "LOADING"
    send_event({
        "event": "status",
        "state": "LOADING",
        "model": model_name,
        "device": device,
        "message": f"모델 ({model_name}) 로딩 중..."
    })

    try:
        target_device = device
        target_compute = compute_type
        if target_device == "cpu":
            target_compute = "int8"

        current_model = faster_whisper.WhisperModel(
            model_name,
            device=target_device,
            compute_type=target_compute
        )
        current_model_name = model_name
        current_device = target_device
        current_compute_type = target_compute
        worker_state = "READY"

        send_event({
            "event": "status",
            "state": "READY",
            "model": current_model_name,
            "device": current_device,
            "compute_type": current_compute_type,
            "message": f"로컬 STT 준비 완료 ({current_model_name} / {current_device} {current_compute_type})"
        })
        return True
    except Exception as e:
        worker_state = "ERROR"
        send_event({
            "event": "error",
            "message": f"모델 로딩 실패: {str(e)}",
            "detail": traceback.format_exc()
        })
        return False


def transcribe_pcm(pcm_bytes, session_id, generation, is_final=True):
    """축적된 PCM 바이트를 Whisper로 전사하고 결과 전송"""
    global current_model, current_initial_prompt
    if not current_model or len(pcm_bytes) < int(SAMPLE_RATE * BYTES_PER_SAMPLE * 0.4):
        return

    try:
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        segments, info = current_model.transcribe(
            samples,
            language="ko",
            task="transcribe",
            initial_prompt=current_initial_prompt if current_initial_prompt else None,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400),
            beam_size=1,
            temperature=0.0,
            best_of=1,
            condition_on_previous_text=False
        )

        texts = []
        confidences = []
        for segment in segments:
            clean_text = segment.text.strip()
            if clean_text:
                texts.append(clean_text)
                prob = math.exp(segment.avg_logprob) if segment.avg_logprob < 0 else 1.0
                confidences.append(min(1.0, max(0.0, prob)))

        if texts:
            combined_text = " ".join(texts)
            avg_confidence = float(np.mean(confidences)) if confidences else 0.90
            send_event({
                "event": "transcript",
                "session_id": session_id,
                "generation": generation,
                "text": combined_text,
                "is_final": is_final,
                "confidence": round(avg_confidence, 2),
                "provider": "LOCAL_WHISPER"
            })
    except Exception as e:
        sys.stderr.write(f"[stt_worker] transcribe 오류: {e}\n")


def process_audio_chunk(raw_bytes):
    """실시간 오디오 청크를 VAD 기반으로 검사 및 버퍼링"""
    global audio_buffer, speech_detected, silence_samples_count, speech_samples_count
    global current_session_id, current_generation

    if worker_state != "LISTENING" or not current_session_id:
        return

    chunk_samples = len(raw_bytes) // BYTES_PER_SAMPLE
    rms = calculate_rms(raw_bytes)
    audio_buffer.extend(raw_bytes)

    if rms >= SILENCE_RMS_THRESHOLD:
        speech_detected = True
        silence_samples_count = 0
        speech_samples_count += chunk_samples
    else:
        if speech_detected:
            silence_samples_count += chunk_samples
            speech_samples_count += chunk_samples

    total_buffered_sec = len(audio_buffer) / BYTES_PER_SEC
    silence_sec = silence_samples_count / SAMPLE_RATE

    should_flush = False
    if speech_detected and silence_sec >= MIN_SILENCE_DURATION_SEC and total_buffered_sec >= MIN_SPEECH_DURATION_SEC:
        should_flush = True
    elif total_buffered_sec >= MAX_SPEECH_BUFFER_SEC:
        should_flush = True

    if should_flush:
        pcm_to_transcribe = bytes(audio_buffer)
        audio_buffer.clear()
        speech_detected = False
        silence_samples_count = 0
        speech_samples_count = 0
        transcribe_pcm(pcm_to_transcribe, current_session_id, current_generation, is_final=True)


def main():
    global worker_state, current_session_id, current_generation, current_initial_prompt
    global audio_buffer, speech_detected, silence_samples_count, speech_samples_count

    send_event({
        "event": "started",
        "has_faster_whisper": faster_whisper is not None
    })

    # 기본 모델 사전 로딩 시도 (base 모델 우선)
    do_load_model("base", device="cpu", compute_type="int8")

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            msg = json.loads(line)
            cmd = msg.get("cmd")

            if cmd == "ping":
                send_event({"event": "pong", "time": time.time()})

            elif cmd == "get_status":
                send_event({
                    "event": "status",
                    "state": worker_state,
                    "model": current_model_name,
                    "device": current_device,
                    "compute_type": current_compute_type
                })

            elif cmd == "load_model":
                model_name = msg.get("model", "base")
                device = msg.get("device", "cpu")
                compute_type = msg.get("compute_type", "int8")
                do_load_model(model_name, device, compute_type)

            elif cmd == "start":
                current_session_id = msg.get("session_id", f"sess-{int(time.time()*1000)}")
                current_generation = msg.get("generation", 1)
                current_initial_prompt = msg.get("prompt", "")
                audio_buffer.clear()
                speech_detected = False
                silence_samples_count = 0
                speech_samples_count = 0
                worker_state = "LISTENING"
                send_event({
                    "event": "listening_started",
                    "session_id": current_session_id,
                    "generation": current_generation
                })

            elif cmd == "audio":
                b64_data = msg.get("data")
                if b64_data:
                    raw_bytes = base64.b64decode(b64_data)
                    process_audio_chunk(raw_bytes)

            elif cmd == "stop":
                req_session_id = msg.get("session_id", current_session_id)
                if speech_detected and len(audio_buffer) >= int(BYTES_PER_SEC * 0.4):
                    transcribe_pcm(bytes(audio_buffer), current_session_id, current_generation, is_final=True)

                audio_buffer.clear()
                speech_detected = False
                silence_samples_count = 0
                speech_samples_count = 0
                worker_state = "READY"
                send_event({
                    "event": "listening_stopped",
                    "session_id": req_session_id
                })

            elif cmd == "quit":
                break

        except Exception as e:
            sys.stderr.write(f"[stt_worker] 메인 루프 예외: {e}\n{traceback.format_exc()}\n")

    send_event({"event": "shutdown"})


if __name__ == "__main__":
    main()
