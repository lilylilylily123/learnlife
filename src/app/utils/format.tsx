import React from "react";

type Options = {
  compact?: boolean; // single-line compact display
};

export function prettyTimestamp(val?: string | null, opts: Options = {}) {
  if (!val) return "—";

  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val; // unknown format, return raw

  const now = Date.now();
  const diff = now - d.getTime();

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateLong = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  // same day — just show time
  const dt = new Date(now);
  if (d.getFullYear() === dt.getFullYear() && d.getMonth() === dt.getMonth() && d.getDate() === dt.getDate()) {
    return opts.compact ? time : (
      <div>
        <div className="text-sm">{time}</div>
        <div className="text-xs text-gray-500">Today</div>
      </div>
    );
  }

  // within a week -> weekday + time
  const dayDiff = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (dayDiff <= 7) {
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    return opts.compact ? `${weekday} ${time}` : (
      <div>
        <div className="text-sm">{weekday}</div>
        <div className="text-xs text-gray-500">{time}</div>
      </div>
    );
  }

  // older -> show date + time
  return opts.compact ? `${dateLong} ${time}` : (
    <div>
      <div className="text-sm">{dateLong}</div>
      <div className="text-xs text-gray-500">{time}</div>
    </div>
  );
}

export default prettyTimestamp;
