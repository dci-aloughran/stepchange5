"use client";

import type { ArchitecturalFeature, Layout } from "@stepchange/shared";
import { useId } from "react";
import {
  conflictSets,
  describeLayout,
  featureShape,
  fitLabel,
  placementKeys,
  placementRect,
  rectCentre,
  schematicFrame,
  ZONE_STYLES,
  zoneRect,
} from "@/lib/plan/schematic";

const WALL = "#e6e0d5";
const FLOOR = "#131c18";
const ERROR = "#f87171";
const WARN = "#fcd34d";

export function RoomSchematic({
  layout,
  features,
  roomName,
}: {
  layout: Layout;
  features: ArchitecturalFeature[];
  roomName: string;
}) {
  const titleId = useId();
  const descId = useId();
  const W = layout.room.widthCm;
  const L = layout.room.lengthCm;
  if (W == null || L == null) {
    return (
      <p className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-muted">
        This room's size is unknown, so the layout can't be drawn to scale.
        Measure it to see the plan.
      </p>
    );
  }
  const f = schematicFrame(W, L);
  const { errors, warnings } = conflictSets(layout.validation);
  const keys = placementKeys(layout.placements);
  const shapes = features
    .map((x) => featureShape(x, W, L))
    .filter((s) => s !== null);
  const kinds = [...new Set(layout.zones.map((z) => z.kind))];
  const labelSize = f.fontSize * 0.8;

  return (
    <figure className="flex flex-col gap-3">
      <svg
        viewBox={f.viewBox}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="w-full rounded-2xl bg-background"
        data-testid="layout-schematic"
      >
        <title id={titleId}>{`To-scale layout plan of ${roomName}`}</title>
        <desc id={descId}>{describeLayout(layout, features)}</desc>

        <rect x={0} y={0} width={W} height={L} fill={FLOOR} />

        {layout.zones.map((z, i) => {
          const s = ZONE_STYLES[z.kind];
          const r = zoneRect(z);
          const dash = s.dashed
            ? `${f.thinStroke * 4} ${f.thinStroke * 3}`
            : undefined;
          if (z.kind === "turning_area") {
            const c = rectCentre(r);
            return (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: zones have no id
                key={`z${i}`}
                cx={c.x}
                cy={c.y}
                r={Math.min(r.w, r.d) / 2}
                fill={s.fill}
                stroke={s.stroke}
                strokeWidth={f.thinStroke * 1.5}
                strokeDasharray={dash}
              />
            );
          }
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: zones have no id
              key={`z${i}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.d}
              fill={s.fill}
              stroke={s.stroke}
              strokeWidth={f.thinStroke}
              strokeDasharray={dash}
            />
          );
        })}

        {layout.placements.map((p, i) => {
          const r = placementRect(p);
          const c = rectCentre(r);
          const isErr = errors.has(p.requirementId);
          const isWarn = warnings.has(p.requirementId);
          const vertical = r.d > r.w * 1.4;
          const text = fitLabel(p.label, r, labelSize);
          return (
            <g key={keys[i]}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.d}
                rx={f.thinStroke * 2}
                fill="rgba(230, 224, 213, 0.22)"
                stroke={
                  isErr ? ERROR : isWarn ? WARN : "rgba(230,224,213,0.75)"
                }
                strokeWidth={
                  isErr || isWarn ? f.thinStroke * 3 : f.thinStroke * 1.5
                }
              />
              {text && (
                <text
                  x={c.x}
                  y={c.y}
                  fontSize={labelSize}
                  fill="#f2ede4"
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={vertical ? `rotate(-90 ${c.x} ${c.y})` : undefined}
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}

        <rect
          x={0}
          y={0}
          width={W}
          height={L}
          fill="none"
          stroke={WALL}
          strokeWidth={f.wallStroke}
        />

        {shapes.map((s) => {
          const opening = (
            <line
              x1={s.from.x}
              y1={s.from.y}
              x2={s.to.x}
              y2={s.to.y}
              strokeWidth={f.wallStroke * 1.3}
              stroke={
                s.type === "door"
                  ? FLOOR
                  : s.type === "window" || s.type === "bay_window"
                    ? "#78b4e6"
                    : "#a7b0a9"
              }
            />
          );
          return (
            <g key={s.id}>
              {opening}
              {s.swingPath && (
                <path
                  d={s.swingPath}
                  fill="none"
                  stroke={WALL}
                  strokeWidth={f.thinStroke * 1.5}
                />
              )}
            </g>
          );
        })}

        {/* Dimensions, north marker and scale bar. */}
        <text
          x={W / 2}
          y={-f.pad * 0.35}
          fontSize={f.fontSize}
          fill="#a7b0a9"
          textAnchor="middle"
        >
          {`${Number((W / 100).toFixed(2))} m`}
        </text>
        <text
          x={-f.pad * 0.35}
          y={L / 2}
          fontSize={f.fontSize}
          fill="#a7b0a9"
          textAnchor="middle"
          transform={`rotate(-90 ${-f.pad * 0.35} ${L / 2})`}
        >
          {`${Number((L / 100).toFixed(2))} m`}
        </text>
        <text
          x={W + f.pad * 0.5}
          y={-f.pad * 0.35}
          fontSize={f.fontSize}
          fill="#a7b0a9"
          textAnchor="middle"
        >
          N ↑
        </text>
        <g>
          <line
            x1={0}
            y1={L + f.pad * 1.1}
            x2={f.scaleBarCm}
            y2={L + f.pad * 1.1}
            stroke="#a7b0a9"
            strokeWidth={f.thinStroke * 2}
          />
          <text
            x={f.scaleBarCm + f.fontSize * 0.5}
            y={L + f.pad * 1.1}
            fontSize={f.fontSize * 0.85}
            fill="#a7b0a9"
            dominantBaseline="central"
          >
            {f.scaleBarCm >= 100
              ? `${f.scaleBarCm / 100} m`
              : `${f.scaleBarCm} cm`}
          </text>
        </g>
      </svg>
      <figcaption>
        <ul
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
          aria-label="Key"
        >
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-sm border border-cream/70 bg-cream/20"
            />
            Furniture
          </li>
          {errors.size > 0 && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-sm border-2 border-red-400"
              />
              Conflict
            </li>
          )}
          {kinds.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-sm border border-dashed"
                style={{
                  background: ZONE_STYLES[k].fill,
                  borderColor: ZONE_STYLES[k].stroke,
                }}
              />
              {ZONE_STYLES[k].legend}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
