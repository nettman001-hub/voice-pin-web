import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  waveform: Uint8Array;
  audioLevel: number;
  isActive: boolean;
  className?: string;
  variant?: 'block' | 'inline';
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  waveform,
  audioLevel,
  isActive,
  className = 'h-7 w-full',
  variant = 'inline',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformRef = useRef<Uint8Array>(waveform);
  const audioLevelRef = useRef<number>(audioLevel);
  const isActiveRef = useRef<boolean>(isActive);
  const animFrameIdRef = useRef<number | null>(null);
  const phaseRef = useRef<number>(0);

  // 최신 props 값을 ref에 동기화
  useEffect(() => {
    waveformRef.current = waveform;
    audioLevelRef.current = audioLevel;
    isActiveRef.current = isActive;
  }, [waveform, audioLevel, isActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;

      const width = canvas.width;
      const height = canvas.height;
      const isCompact = height <= 40;
      ctx.clearRect(0, 0, width, height);

      const active = isActiveRef.current;
      const currentLevel = audioLevelRef.current || 0;
      const currentWaveform = waveformRef.current;
      phaseRef.current += 0.05;

      if (!active) {
        // [대기 상태] 은은한 중심 점선 가이드
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = isCompact ? 1.5 : 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.setLineDash([]); // 복원
      } else {
        // [활성 상태] 이퀄라이저 바 렌더링
        const barCount = isCompact ? 28 : 36;
        const barWidth = (width / barCount) * (isCompact ? 0.55 : 0.6);
        const gap = (width / barCount) * (isCompact ? 0.45 : 0.4);
        const barRadius = isCompact ? 2 : 4;
        const minBarHeight = isCompact ? 3 : 6;

        for (let i = 0; i < barCount; i++) {
          let val = 0;
          if (currentWaveform && currentWaveform.length > 0) {
            const dataIndex = Math.floor((i / barCount) * (currentWaveform.length / 2));
            val = currentWaveform[dataIndex] || 0;
          }

          // 마이크 입력 레벨 가중치 및 자연스러운 앰비언트 파동 합성
          const ambientWave = Math.sin(phaseRef.current + i * 0.35) * (isCompact ? 5 : 8) + Math.cos(phaseRef.current * 0.7 + i * 0.2) * (isCompact ? 3 : 5);
          const levelBoost = currentLevel * (isCompact ? 1.5 : 1.8);
          const combinedVal = Math.max(isCompact ? 8 : 12, val * 0.85 + levelBoost + ambientWave);

          const percent = Math.min(0.92, Math.max(0.1, combinedVal / 255));
          const barHeight = Math.max(minBarHeight, height * percent);

          const x = i * (barWidth + gap) + gap / 2;
          const y = (height - barHeight) / 2;

          // 화사하고 선명한 그라디언트 (Brand Indigo -> Cyan -> Pink)
          const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
          grad.addColorStop(0, '#06b6d4');   // cyan-500
          grad.addColorStop(0.5, '#6366f1'); // brand-500
          grad.addColorStop(1, '#ec4899');   // pink-500

          ctx.fillStyle = grad;
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, barRadius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, barWidth, barHeight);
          }
        }

        // 중앙 연결 실시간 웨이브 라인 (부드러운 유기적 파동)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
        ctx.lineWidth = isCompact ? 1.5 : 2;
        const waveAmp = isCompact ? Math.max(2, currentLevel * 0.25) : Math.max(4, currentLevel * 0.4);
        for (let x = 0; x <= width; x += 10) {
          const y = height / 2 + Math.sin(phaseRef.current * 2 + x * (isCompact ? 0.05 : 0.04)) * waveAmp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, []);

  if (variant === 'inline') {
    return (
      <div className="relative w-full h-full overflow-hidden rounded-xl bg-slate-50/90 border border-slate-200/80 shadow-2xs">
        <canvas
          ref={canvasRef}
          width={400}
          height={28}
          className={`w-full ${className} block`}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-slate-50 border border-slate-200 shadow-inner">
      <canvas
        ref={canvasRef}
        width={600}
        height={90}
        className={`w-full ${className} block`}
      />
      {isActive && (
        <div className="absolute right-3 top-2 flex items-center space-x-1.5 bg-white/80 backdrop-blur-sm px-2 py-0.5 rounded-full border border-slate-200 text-[10px] font-bold text-brand-600 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
          <span>LIVE AUDIO</span>
        </div>
      )}
    </div>
  );
};
