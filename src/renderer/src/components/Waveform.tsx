import React, { useCallback, useRef, useState } from 'react';

/**
 * Waveform leggera per l'Auto-Cue: disegna l'envelope RMS (max ~480 bucket,
 * arriva dal sidecar — non sono campioni audio) e i marker dei cue proposti.
 * I marker si trascinano col mouse per spostare il cue; nessuna riproduzione
 * audio: è uno strumento di posizionamento, il controllo d'ascolto resta in
 * Rekordbox (onestà §1).
 */

export interface WaveCue {
  label: string;
  positionMs: number;
  color: string | null;
}

const H = 96; // altezza svg (px logici)

export function Waveform({
  envelope,
  durationS,
  cues,
  onMoveCue
}: {
  envelope: number[];
  durationS: number;
  cues: WaveCue[];
  onMoveCue: (index: number, positionMs: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const durationMs = durationS * 1000;
  const W = Math.max(envelope.length, 100);

  const clientXToMs = useCallback(
    (clientX: number): number => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(frac * durationMs);
    },
    [durationMs]
  );

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIndex === null) return;
    onMoveCue(dragIndex, clientXToMs(e.clientX));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragIndex !== null) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      setDragIndex(null);
    }
  };

  if (!envelope.length || durationMs <= 0) return null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-24 w-full touch-none select-none rounded-md border bg-muted/30"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      {/* envelope speculare sopra/sotto la mediana */}
      {envelope.map((v, i) => {
        const h = Math.max(1, v * (H / 2 - 4));
        const x = (i / envelope.length) * W;
        return (
          <rect
            key={i}
            x={x}
            y={H / 2 - h}
            width={Math.max(0.6, W / envelope.length - 0.25)}
            height={h * 2}
            className="fill-primary/40"
          />
        );
      })}
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="stroke-border" strokeWidth={0.5} />

      {/* marker cue: linea + maniglia trascinabile */}
      {cues.map((c, i) => {
        const x = Math.min(W, Math.max(0, (c.positionMs / durationMs) * W));
        const color = c.color ?? '#888888';
        return (
          <g key={i}>
            <line x1={x} y1={0} x2={x} y2={H} stroke={color} strokeWidth={dragIndex === i ? 2.5 : 1.5} />
            {/* maniglia larga invisibile: bersaglio comodo per il drag */}
            <rect
              x={x - 4}
              y={0}
              width={8}
              height={H}
              fill="transparent"
              style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDragIndex(i);
              }}
            />
            <rect x={x - 5} y={0} width={10} height={12} rx={2} fill={color} pointerEvents="none" />
            <text
              x={x + 7}
              y={11}
              fontSize={9}
              fill="currentColor"
              className="text-foreground"
              pointerEvents="none"
            >
              {c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
