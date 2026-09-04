# -*- coding: utf-8 -*-
"""
VoiceCAP Offline STT Worker (faster-whisper)
실시간 한국어 라이브 방송 음성인식 전용 워커 프로세스.
표준 입출력(stdin/stdout)을 통한 JSON-RPC 통신으로 Node.js 브리지 서버와 연동됩니다.

[개선 반영 (OFFLINE_STT_DIAGNOSIS_REPORT)]:
1. 모델 교체 시 명시적 GC(del + gc.collect)로 메모리 중복 점유(mkl_malloc 에러) 방지
2. 비정상 반복 생성(한 글자/어절 연속 반복, 높은 compression_ratio) 필터링
3. 발화 기반 VAD + pre-roll 버퍼(250ms)로 자음 유실 방지 및 고정 3.5초 절단 폐지
4. 세션 generation 및 모델 준비 상태 검증
5. 진단용 WAV 오디오 덤프 지원 (VOICECAP_STT_DUMP_DIR)
"""

import sys
import os
import json
import base64
import time
import math
import gc
import re
import wave
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

# VAD 파라미터
SILENCE_RMS_THRESHOLD = 0.012         # 발화 감지 RMS 기준
MIN_SPEECH_DURATION_SEC = 0.45        # 최소 발화 길이 (너무 짧은 노이즈 무시)
MIN_SILENCE_DURATION_SEC = 0.45       # 발화 종료 판단 무음 지속 시간
MAX_SPEECH_BUFFER_SEC = 6.0           # 최대 연속 발화 버퍼 (6초 초과 시 안전 분할)
PRE_ROLL_BUFFER_SEC = 0.25            # 발화 시작 전 보존 버퍼 (첫 자음 유실 방지: 약 250ms)
PRE_ROLL_BYTES = int(BYTES_PER_SEC * PRE_ROLL_BUFFER_SEC)  # 8000 bytes

current_model = None
current_model_name = ""
current_device = "cpu"
current_compute_type = "int8"
worker_state = "IDLE"  # IDLE | LOADING | READY | LISTENING | ERROR
last_error_info = None

current_session_id = ""
current_generation = 0
current_initial_prompt = ""

audio_buffer = bytearray()
pre_roll_buffer = bytearray()
speech_detected = False
silence_samples_count = 0

# 진단용 WAV 저장 디렉터리 (환경변수 또는 설정)
DUMP_DIR = os.environ.get("VOICECAP_STT_DUMP_DIR", "")
if DUMP_DIR:
    try:
        os.makedirs(DUMP_DIR, exist_ok=True)
    except Exception:
        DUMP_DIR = ""


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
    sub_samples = samples[::8].astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(sub_samples ** 2))) if len(sub_samples) > 0 else 0.0


def check_abnormal_repetition(text, segments, audio_duration_sec):
    """
    환각 및 비정상 반복 텍스트 검출:
    1. 동일 글자 4회 이상 연속 반복 (예: '가가가가', '1111')
    2. 동일 단어(어절) 3회 이상 연속 반복 (예: '네네 네네 네네')
    3. 2어절 이상 구문 연속 2회 이상 반복
    4. 세그먼트 고압축률 (compression_ratio > 2.4)
    5. 세그먼트 무음 확률 높음 (no_speech_prob > 0.65)
    6. 발화 시간 대비 비정상적 과다 텍스트 (초당 18자 초과)
    """
    if not text or len(text.strip()) == 0:
        return True, "EMPTY_TEXT"

    stripped = text.strip()

    # 1. 단일 글자 연속 4회 이상 반복 검출
    if re.search(r'([가-힣a-zA-Z0-9])\1{3,}', stripped):
        return True, "CHAR_REPETITION"

    # 2. 어절 연속 3회 이상 반복 검출
    words = stripped.split()
    if len(words) >= 3:
        for i in range(len(words) - 2):
            if words[i] == words[i+1] == words[i+2]:
                return True, "WORD_REPETITION"

    # 3. 2어절 구문 연속 2회 이상 반복
    if len(words) >= 4:
        for i in range(len(words) - 3):
            phrase1 = f"{words[i]} {words[i+1]}"
            phrase2 = f"{words[i+2]} {words[i+3]}"
            if phrase1 == phrase2 and len(phrase1) >= 4:
                return True, "PHRASE_REPETITION"

    # 4. 세그먼트 메타데이터 검증
    for seg in segments:
        comp = getattr(seg, 'compression_ratio', None)
        if comp is not None and comp > 2.4:
            return True, f"HIGH_COMPRESSION_RATIO_{round(comp, 2)}"
        no_speech = getattr(seg, 'no_speech_prob', None)
        if no_speech is not None and no_speech > 0.65:
            return True, f"HIGH_NO_SPEECH_PROB_{round(no_speech, 2)}"

    # 5. 발화 시간 대비 글자 수 검증 (초당 18자 초과)
    if audio_duration_sec > 0.4:
        pure_char_count = len(stripped.replace(" ", ""))
        cps = pure_char_count / audio_duration_sec
        if pure_char_count >= 15 and cps > 18.0:
            return True, f"EXCESSIVE_CHARS_PER_SEC_{round(cps, 1)}"

    return False, ""


def dump_audio_if_enabled(pcm_bytes, session_id):
    """진단용 입력 오디오 WAV 파일 저장"""
    if not DUMP_DIR:
        return
    try:
        ts = int(time.time() * 1000)
        filename = os.path.join(DUMP_DIR, f"stt_{session_id}_{ts}.wav")
        with wave.open(filename, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(BYTES_PER_SAMPLE)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm_bytes)
    except Exception as e:
        sys.stderr.write(f"[stt_worker] WAV 덤프 실패: {e}\n")


def do_load_model(model_name="base", device="cpu", compute_type="int8"):
    global current_model, current_model_name, current_device, current_compute_type, worker_state, last_error_info

    if faster_whisper is None:
        worker_state = "ERROR"
        last_error_info = {
            "error_code": "NO_FASTER_WHISPER",
            "message": "faster-whisper 패키지가 설치되어 있지 않습니다.",
            "timestamp": time.time()
        }
        send_event({
            "event": "error",
            **last_error_info
        })
        return False

    # 이미 동일한 모델, 장치, 연산 타입으로 성공 로드되어 있다면 재로딩 생략
    if (current_model is not None and
            current_model_name == model_name and
            current_device == device and
            current_compute_type == compute_type):
        worker_state = "READY"
        last_error_info = None
        send_event({
            "event": "status",
            "state": "READY",
            "model": current_model_name,
            "device": current_device,
            "compute_type": current_compute_type,
            "message": f"로컬 STT 준비 완료 ({current_model_name} / {current_device} {current_compute_type})"
        })
        return True

    worker_state = "LOADING"
    send_event({
        "event": "status",
        "state": "LOADING",
        "model": model_name,
        "device": device,
        "message": f"모델 ({model_name}) 로딩 중..."
    })

    try:
        # Celeron J4105 등 저메모리 PC를 위해 기존 모델 객체 명시적 파기 및 GC 수행
        if current_model is not None:
            del current_model
            current_model = None
            gc.collect()

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
        last_error_info = None

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
        # 실패 시 잔여 참조 완전 정리
        current_model = None
        current_model_name = ""
        gc.collect()
        worker_state = "ERROR"
        last_error_info = {
            "error_code": "MODEL_LOAD_FAILED",
            "failed_model": model_name,
            "message": f"모델 로딩 실패: {str(e)}",
            "timestamp": time.time()
        }
        send_event({
            "event": "error",
            **last_error_info,
            "detail": traceback.format_exc()
        })
        return False


def transcribe_pcm(pcm_bytes, session_id, generation, is_final=True):
    """축적된 PCM 바이트를 Whisper로 전사하고 결과 검증 후 전송"""
    global current_model, current_initial_prompt
    if not current_model or len(pcm_bytes) < int(SAMPLE_RATE * BYTES_PER_SAMPLE * 0.4):
        return

    audio_duration_sec = len(pcm_bytes) / BYTES_PER_SEC
    dump_audio_if_enabled(pcm_bytes, session_id)

    infer_start_time = time.time()
    try:
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # CTranslate2 / faster-whisper 추론 파라미터 (반복 억제 적용)
        segments_gen, info = current_model.transcribe(
            samples,
            language="ko",
            task="transcribe",
            initial_prompt=current_initial_prompt if current_initial_prompt else None,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=300),
            beam_size=1,
            temperature=0.0,
            best_of=1,
            repetition_penalty=1.1,
            condition_on_previous_text=False
        )

        segments = list(segments_gen)
        infer_duration = time.time() - infer_start_time

        texts = []
        confidences = []
        for segment in segments:
            clean_text = segment.text.strip()
            if clean_text:
                texts.append(clean_text)
                prob = math.exp(segment.avg_logprob) if segment.avg_logprob < 0 else 1.0
                confidences.append(min(1.0, max(0.0, prob)))

        if not texts:
            return

        combined_text = " ".join(texts)
        avg_confidence = float(np.mean(confidences)) if confidences else 0.90

        # 비정상 반복 생성 및 환각 검증
        is_abnormal, abnormal_reason = check_abnormal_repetition(combined_text, segments, audio_duration_sec)

        payload = {
            "event": "transcript",
            "session_id": session_id,
            "generation": generation,
            "text": combined_text,
            "is_final": is_final,
            "confidence": round(avg_confidence, 2),
            "provider": "LOCAL_WHISPER",
            "duration": round(audio_duration_sec, 2),
            "infer_time": round(infer_duration, 3),
            "is_abnormal": is_abnormal
        }

        if is_abnormal:
            payload["abnormal_reason"] = abnormal_reason
            sys.stderr.write(f"[stt_worker] 비정상 전사 차단 ({abnormal_reason}): '{combined_text}'\n")

        send_event(payload)

    except Exception as e:
        sys.stderr.write(f"[stt_worker] transcribe 오류: {e}\n{traceback.format_exc()}\n")


def process_audio_chunk(raw_bytes):
    """
    실시간 오디오 청크를 VAD 기반으로 검사 및 버퍼링
    - 발화 시작 전 250ms pre-roll 버퍼 유지 (첫소리 유실 방지)
    - 발화 감지 후 450ms 무음 지속 시 발화 단위로 플러시
    - 연속 6초 초과 발화 시 안전 분할
    """
    global audio_buffer, pre_roll_buffer, speech_detected, silence_samples_count
    global current_session_id, current_generation

    if worker_state != "LISTENING" or not current_session_id:
        return

    chunk_samples = len(raw_bytes) // BYTES_PER_SAMPLE
    rms = calculate_rms(raw_bytes)

    if rms >= SILENCE_RMS_THRESHOLD:
        # 음성 신호 감지
        if not speech_detected:
            speech_detected = True
            # pre-roll 버퍼를 오디오 버퍼 앞단에 병합
            audio_buffer.extend(pre_roll_buffer)
            pre_roll_buffer.clear()

        silence_samples_count = 0
        audio_buffer.extend(raw_bytes)
    else:
        # 무음 신호
        if speech_detected:
            # 발화 중 나타난 무음 누적
            silence_samples_count += chunk_samples
            audio_buffer.extend(raw_bytes)
        else:
            # 발화 이전 무음: pre-roll 버퍼에 최근 250ms만 유지
            pre_roll_buffer.extend(raw_bytes)
            if len(pre_roll_buffer) > PRE_ROLL_BYTES:
                del pre_roll_buffer[:-PRE_ROLL_BYTES]

    # 플러시 여부 결정
    total_buffered_sec = len(audio_buffer) / BYTES_PER_SEC
    silence_sec = silence_samples_count / SAMPLE_RATE

    should_flush = False
    if speech_detected and silence_sec >= MIN_SILENCE_DURATION_SEC and total_buffered_sec >= MIN_SPEECH_DURATION_SEC:
        # 발화 완료 후 충분한 무음 확인됨
        should_flush = True
    elif total_buffered_sec >= MAX_SPEECH_BUFFER_SEC:
        # 최대 버퍼 한도 도달
        should_flush = True

    if should_flush:
        pcm_to_transcribe = bytes(audio_buffer)
        audio_buffer.clear()
        pre_roll_buffer.clear()
        speech_detected = False
        silence_samples_count = 0
        transcribe_pcm(pcm_to_transcribe, current_session_id, current_generation, is_final=True)


def main():
    global worker_state, current_session_id, current_generation, current_initial_prompt
    global audio_buffer, pre_roll_buffer, speech_detected, silence_samples_count

    send_event({
        "event": "started",
        "has_faster_whisper": faster_whisper is not None
    })

    # Celeron J4105 친화적 기본 모델(base) 사전 로딩 시도
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
                status_payload = {
                    "event": "status",
                    "state": worker_state,
                    "model": current_model_name,
                    "device": current_device,
                    "compute_type": current_compute_type
                }
                if last_error_info:
                    status_payload["last_error"] = last_error_info
                send_event(status_payload)

            elif cmd == "load_model":
                model_name = msg.get("model", "base")
                device = msg.get("device", "cpu")
                compute_type = msg.get("compute_type", "int8")
                do_load_model(model_name, device, compute_type)

            elif cmd == "start":
                # 모델 미준비 상태에서 청취 시작 방지
                if current_model is None:
                    send_event({
                        "event": "error",
                        "error_code": "MODEL_NOT_READY",
                        "message": "STT 모델이 로드되지 않아 청취를 시작할 수 없습니다.",
                        "timestamp": time.time()
                    })
                    continue

                current_session_id = msg.get("session_id", f"sess-{int(time.time()*1000)}")
                current_generation = msg.get("generation", 1)
                current_initial_prompt = msg.get("prompt", "")
                audio_buffer.clear()
                pre_roll_buffer.clear()
                speech_detected = False
                silence_samples_count = 0
                worker_state = "LISTENING"

                send_event({
                    "event": "listening_started",
                    "session_id": current_session_id,
                    "generation": current_generation,
                    "model": current_model_name,
                    "device": current_device,
                    "compute_type": current_compute_type
                })

            elif cmd == "audio":
                # 청취 중이며 세션 ID가 일치할 때만 처리
                req_sess = msg.get("session_id")
                req_gen = msg.get("generation")
                if req_sess and req_sess != current_session_id:
                    continue
                if req_gen and req_gen != current_generation:
                    continue

                b64_data = msg.get("data")
                if b64_data:
                    raw_bytes = base64.b64decode(b64_data)
                    process_audio_chunk(raw_bytes)

            elif cmd == "stop":
                req_session_id = msg.get("session_id", current_session_id)
                # 남아있는 유효 발화가 있으면 마지막 플러시
                if speech_detected and len(audio_buffer) >= int(BYTES_PER_SEC * MIN_SPEECH_DURATION_SEC):
                    transcribe_pcm(bytes(audio_buffer), current_session_id, current_generation, is_final=True)

                audio_buffer.clear()
                pre_roll_buffer.clear()
                speech_detected = False
                silence_samples_count = 0
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
