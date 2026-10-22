"use client";
// «عکس بگیر»: opens the camera on phones (file picker / drag-in on desktop), shrinks the photo and opens /snap.
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { keepPhoto, shrinkPhoto } from "@/lib/photo";
import { Icon } from "./Icon";

export function SnapButton({ className = "iconbtn", label, children, onError }: {
  className?: string; label?: string; children?: ReactNode; onError?: (msg: string) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      keepPhoto(await shrinkPhoto(f));
      router.push(`/snap?t=${Date.now()}`); // a fresh key each time so the same screen re-reads a new photo
    } catch (e) {
      onError?.((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <label htmlFor={id} className={className} aria-label={label ?? "عکس از کالا"} title={label ?? "عکس از کالا: مدل و قیمت را بسنجیم"} style={{ cursor: "pointer" }}>
      {busy ? <span className="spin" /> : children ?? <Icon n="cam" s />}
      <input id={id} type="file" accept="image/*" capture="environment" className="sr" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}
