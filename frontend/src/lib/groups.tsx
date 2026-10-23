// The kinds of market stall (see backend services/groups.py): one small icon each, shared by the map pins, the category chips and the legend.
import type { ReactElement } from "react";

export type GroupKey = "mobile" | "security" | "lighting" | "computer" | "audio" | "fashion" | "beauty" | "home" | "tools" | "electrical" | "other";

// 24×24 outline glyphs, drawn with a 2px stroke
export const GROUPS: Record<GroupKey, { label: string; color: string; d: string }> = {
  mobile: { label: "موبایل و لوازم", color: "#0ea5e9", d: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.2h2"/>' },
  security: { label: "دوربین و امنیتی", color: "#c026d3", d: '<rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="M15.5 10.5 21 8v8l-5.5-2.5"/>' },
  lighting: { label: "لامپ و روشنایی", color: "#ca8a04", d: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.7.6 1.3 1.4 1.3 2.4h5c0-1 .6-1.8 1.3-2.4A6 6 0 0 0 12 3z"/>' },
  computer: { label: "کامپیوتر و شبکه", color: "#4f46e5", d: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19.5h19"/>' },
  audio: { label: "صوتی و تصویری", color: "#0d9488", d: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6.5" rx="1.2"/><rect x="17" y="14" width="4" height="6.5" rx="1.2"/>' },
  fashion: { label: "پوشاک و کیف", color: "#be123c", d: '<path d="M6 8.5h12l1 12H5z"/><path d="M9 8.5a3 3 0 0 1 6 0"/>' },
  beauty: { label: "آرایشی و سلامت", color: "#ec4899", d: '<path d="M12 20.5s-7.5-4.6-7.5-10.4A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.5c0 5.8-7.5 10.4-7.5 10.4z"/>' },
  home: { label: "لوازم خانه و شخصی", color: "#65a30d", d: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>' },
  tools: { label: "ابزار و صنعتی", color: "#92400e", d: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.4-5.4L15 12l-2.6-.6L11.8 8.8z"/>' },
  electrical: { label: "برق و الکترونیک", color: "#ea580c", d: '<path d="M13 2.5 5 13.5h6.5L10.5 21.5l8-11H12z"/>' },
  other: { label: "سایر یا نامشخص", color: "#9aa3b2", d: '<path d="M4 9.5 5.2 4.5h13.6L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5v8h13v-8"/>' },
};
export const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[];
export const asGroup = (g: string | null | undefined): GroupKey => (g && g in GROUPS ? (g as GroupKey) : "other");

export function GroupIcon({ g, size = 16 }: { g: string | null | undefined; size?: number }): ReactElement {
  const k = asGroup(g);
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GROUPS[k].d }} />;
}

/** A round map badge: the group's colour, white outline glyph. `ring` adds the violet «found it» halo around it. Returned as an SVG string for the map to turn into a sprite. */
export const badgeSvg = (g: GroupKey, ring = false, px = 80) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 40 40">${ring ? '<circle cx="20" cy="20" r="18.6" fill="#fff" stroke="#6d3df0" stroke-width="2.8"/>' : ""}<circle cx="20" cy="20" r="${ring ? 15 : 17}" fill="${GROUPS[g].color}" stroke="#fff" stroke-width="2.2"/><g transform="translate(9.6 9.6) scale(.87)" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${GROUPS[g].d}</g></svg>`;
