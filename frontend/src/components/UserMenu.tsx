"use client";
// The signed-in user in the corner: tap for «حساب کاربری» and «خروج». Signed out it is just the sign-in link.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";

export function UserMenu({ className = "chip", compact = false, style }: { className?: string; compact?: boolean; style?: React.CSSProperties }) {
  const { user, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!user) return <Link href="/login" className={className} style={style}>ورود</Link>;
  return (
    <span className="um" ref={box}>
      <button type="button" className={className} style={style} aria-haspopup="menu" aria-expanded={open} aria-label={`حساب ${user.username}`} onClick={() => setOpen((o) => !o)}>
        <span className="auth-avatar" style={{ width: 24, height: 24, fontSize: 12 }}>{user.username.slice(0, 1).toUpperCase()}</span>{!compact && <bdi>{user.username}</bdi>}
      </button>
      {open && (
        <div className="um-pop" role="menu">
          <Link role="menuitem" href="/login" onClick={() => setOpen(false)}>حساب کاربری</Link>
          <button type="button" role="menuitem" onClick={async () => { setOpen(false); await signOut(); router.push("/"); }}>خروج</button>
        </div>
      )}
    </span>
  );
}
