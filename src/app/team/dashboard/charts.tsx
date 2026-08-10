"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LEAD_STATUS_LABELS, POLICY_STATUS_LABELS } from "@/lib/status-labels";

// Chart layer for the Manager/Head dashboard (Section 10 phase 13). Follows
// the project's data-viz conventions: sequential blue for plain magnitude
// comparisons, the reserved status palette only for genuine record-status
// (won/lost, policy status) — never a generated rainbow — thin bars/lines,
// rounded data-ends, hairline recessive gridlines, and a hover tooltip on
// every chart (an HTML/SVG chart is interactive by default).

const GRID_COLOR = "#e1e0d9";
const AXIS_TICK = { fill: "#898781", fontSize: 12 };
const TOOLTIP_STYLE = {
  background: "#fcfcfb",
  border: "1px solid rgba(11,11,11,0.10)",
  borderRadius: 6,
  fontSize: 12,
  color: "#0b0b0b",
};

// Sequential blue, ordinal ramp (palette.md: "funnel stages, tiers"),
// lightest step no lighter than 250 so it still clears 2:1 on the surface.
const FUNNEL_STAGE_COLORS: Record<string, string> = {
  new: "#86b6ef",
  contacted: "#5598e7",
  quoted: "#2a78d6",
  negotiating: "#1c5cab",
};
// won/lost are a genuine binary outcome, not a further funnel stage —
// status palette, not the ordinal ramp.
const STATUS_GOOD = "#0ca30c";
const STATUS_CRITICAL = "#d03b3b";

const POLICY_STATUS_COLORS: Record<string, string> = {
  draft: "#898781",
  active: STATUS_GOOD,
  grace_period: "#fab219",
  lapsed: "#ec835a",
  cancelled: STATUS_CRITICAL,
  completed: STATUS_GOOD,
};

const SEQUENTIAL_BLUE = "#2a78d6";

export function PipelineFunnelChart({ data }: { data: { status: string; count: number }[] }) {
  const rows = data.map((d) => ({
    ...d,
    label: LEAD_STATUS_LABELS[d.status] ?? d.status,
    fill: d.status === "won" ? STATUS_GOOD : d.status === "lost" ? STATUS_CRITICAL : FUNNEL_STAGE_COLORS[d.status],
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f0efec" }} />
        <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.status} fill={r.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ConversionByLineChart({
  data,
}: {
  data: { line: string; leadsTotal: number; won: number; lost: number; conversionRate: number | null }[];
}) {
  const rows = data.map((d) => ({ ...d, pct: d.conversionRate === null ? 0 : Math.round(d.conversionRate * 100) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 44)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="line" tick={AXIS_TICK} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} width={100} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "#f0efec" }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, _name: any, item: any) => [`${value}% (${item.payload.won}/${item.payload.won + item.payload.lost} closed)`, "Conversion"]}
        />
        <Bar dataKey="pct" name="Conversion" fill={SEQUENTIAL_BLUE} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PoliciesByStatusChart({ data }: { data: { status: string; count: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: POLICY_STATUS_LABELS[d.status] ?? d.status, fill: POLICY_STATUS_COLORS[d.status] }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f0efec" }} />
        <Bar dataKey="count" name="Policies" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.status} fill={r.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Two single-series line charts, not one dual-axis chart — sales count and
// premium are different scales/units, and a dual-axis chart is the #1
// data-viz mistake to avoid.
export function TrendCharts({ data }: { data: { label: string; salesCount: number; premium: number }[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">Sales activated per month</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={24} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [v, "Sales"]} />
            <Line
              type="monotone"
              dataKey="salesCount"
              name="Sales"
              stroke={SEQUENTIAL_BLUE}
              strokeWidth={2}
              dot={{ r: 4, fill: SEQUENTIAL_BLUE, stroke: "#fcfcfb", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">Premium activated per month (₱)</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : `${v}`)}
            />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`₱${Number(v).toLocaleString()}`, "Premium"]} />
            <Line
              type="monotone"
              dataKey="premium"
              name="Premium"
              stroke={SEQUENTIAL_BLUE}
              strokeWidth={2}
              dot={{ r: 4, fill: SEQUENTIAL_BLUE, stroke: "#fcfcfb", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
