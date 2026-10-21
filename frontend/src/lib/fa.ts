// Persian number/price/time formatting. Model names and units stay Latin; wrap them with <Bidi>.
const FA = "۰۱۲۳۴۵۶۷۸۹";

export const fa = (s: string | number | null | undefined) => String(s ?? "").replace(/\d/g, (d) => FA[+d]);

/** Accepts Persian/Arabic digits and separators; returns a plain integer or null. */
export const parseNum = (s: string) => {
  const latin = s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const n = parseInt(latin.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

export const money = (n: number) => fa(Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "٬"));

/** ۲٫۴۹ میلیون / ۸۵۰ هزار */
export const mil = (n: number) => {
  if (n < 1_000_000) return `${fa(Math.round(n / 1000))} هزار`;
  const m = n / 1e6;
  const s = (m >= 10 ? m.toFixed(1) : m.toFixed(2)).replace(/0+$/, "").replace(/\.$/, "").replace(".", "٫");
  return `${fa(s)} میلیون`;
};

export const daysAgo = (d: number | null | undefined) => (d == null ? "" : d === 0 ? "امروز" : `${fa(d)} روز پیش`);

export const minutesAgo = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return "همین الان";
  if (m < 60) return `${fa(m)} دقیقه پیش`;
  const h = Math.round(m / 60);
  return h < 24 ? `${fa(h)} ساعت پیش` : `${fa(Math.round(h / 24))} روز پیش`;
};

/** "19:00:00" or "19:00" → «۱۹:۰۰» */
export const hm = (t: string | null | undefined) => fa((t ?? "").slice(0, 5));

/** Tehran wall-clock time for an ISO timestamp, 24h. */
export const clock = (iso: string) =>
  fa(new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }));

export const mmss = (sec: number) => fa(`${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`);

/** Floor labels from the API carry Latin digits ("طبقه منفی 1"); a few are words ("چهار"). */
export const floorLabel = (l: string | null | undefined) => (l ? fa(l.replace(/^چهار$/, "طبقه 4")) : null);

export const walk = (min: number | null | undefined) =>
  min == null ? "" : min === 0 ? "کمتر از ۱ دقیقه" : `${fa(min)} دقیقه`;
