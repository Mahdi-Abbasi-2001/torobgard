"use client";
// «نمایش مسیر»: the app's own walking route to a shop or an area, in a sheet, from the shopper's chosen start point. It replaces the
// buttons that sent people to other map apps.
import dynamic from "next/dynamic";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { Bidi, Note, Sheet } from "@/components/ui";

const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false, loading: () => <div className="sk" style={{ height: 520, borderRadius: 18 }} /> });

export function RouteButton({ to, label, className = "btn sec grow", style }: { to: { lat: number; lon: number }; label: string; className?: string; style?: React.CSSProperties }) {
  const { state } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)}><Icon n="walk" s />نمایش مسیر</button>
      <Sheet open={open} onClose={() => setOpen(false)} label="مسیر" className="tall">
        <div className="row between"><div><div className="mc-label">مسیر تا</div><div className="b" style={{ fontSize: 17 }}><Bidi text={label} /></div></div>
          <button className="iconbtn soft" onClick={() => setOpen(false)} aria-label="بستن"><Icon n="x" /></button></div>
        {state.place.source === "default" && <Note tone="unk" icon="pin">هنوز موقعیت خود را انتخاب نکرده‌اید؛ مسیر از مرکز تهران حساب شده است. موقعیت را از صفحهٔ اصلی انتخاب کنید.</Note>}
        {open && <RouteMap from={state.place} to={to} label={label} mode={state.mode} height={520} />}
      </Sheet>
    </>
  );
}
