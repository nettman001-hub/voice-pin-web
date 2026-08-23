import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  waveform: Uint8Array;
  audioLevel: number;
  isActive: boolean;
  className?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  waveform,
  audioLevel,
  isActive,
  className = 'h-16 w-full'
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!isActive) {
      // 대기 상태 점선 라인
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    const barCount = 32;
    const barWidth = (width / barCount) * 0.65;
    const gap = (width / barCount) * 0.35;

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * (waveform.length / 2));
      const val = waveform[dataIndex] || (audioLevel * 2.5);
      const percent = Math.min(1, Math.max(0.08, val / 255));
      const barHeight = Math.max(4, height * percent);

      const x = i * (barWidth + gap);
      const y = (height - barHeight) / 2;

      // 생동감 있는 그라디언트
      const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
      grad.addColorStop(0, '#0ea5e9');
      grad.addColorStop(0.5, '#3b82f6');
      grad.addColorStop(1, '#ec4899');

      ctx.fillStyle = grad;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 3);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    }
  }, [waveform, audioLevel, isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={80}
      className={`rounded-2xl bg-slate-50 border border-slate-200 shadow-inner ${className}`}
    />
  );
};
