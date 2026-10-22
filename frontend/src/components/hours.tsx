"use client";
// Weekly opening hours from the dataset, with the day's declared hours checked for plausibility (a 03:00 opening is flagged, not hidden).
import type { DayHours, Weekday } from "@/lib/api";
import { hm } from "@/lib/fa";

export const DAYS: [Weekday, string][] = [["sat", "شنبه"], ["sun", "یکشنبه"], ["mon", "دوشنبه"], ["tue", "سه‌شنبه"], ["wed", "چهارشنبه"], ["thu", "پنجشنبه"], ["fri", "جمعه"]];
export const todayKey = (): Weekday => {
  const d = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Tehran" }).toLowerCase().slice(0, 3);
  return d as Weekday;
};
export const realShifts = (d: DayHours) => d.shifts.filter((x) => !(x.start_time === "00:00:00" && x.end_time === "00:00:00"));
export const looksWrong = (d: DayHours) => d.status === "unsupported" || (d.status === "declared" && realShifts(d).some((x) => x.start_time < "06:00:00" || x.start_time === x.end_time));

export function Hours({ wh }: { wh: Record<Weekday, DayHours> }) {
  const today = todayKey();
  return (
    <table className="hours"><tbody>
      {DAYS.map(([k, l]) => {
        const d = wh[k];
        const sh = d ? realShifts(d) : [];
        const bad = d && looksWrong(d);
        const v = !d ? "نامشخص" : d.status === "closed" ? "تعطیل" : d.status === "unsupported" ? "نامعتبر" : sh.map((x) => `${hm(x.start_time)}–${hm(x.end_time)}`).join("، ") || "تعطیل";
        return (
          <tr key={k} className={`${k === today ? "today" : ""} ${k === "fri" ? "fri" : ""}`}>
            <td>{l}{k === today ? " · امروز" : ""}</td>
            <td>{bad ? <span className="bad">{v} ⚠</span> : v}</td>
          </tr>
        );
      })}
    </tbody></table>
  );
}

