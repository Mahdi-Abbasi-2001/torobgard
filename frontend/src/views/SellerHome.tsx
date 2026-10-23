"use client";
// The seller's front door: sign in to the shop account, or create one with the shop code (from the seller link or the Bale bot). Signed in as a
// seller you land in the light seller app; shopper accounts never see it.
import { useState } from "react";
import Link from "next/link";
import { api, authStore } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { Note, Seg, SkeletonCards } from "@/components/ui";
import SellerView from "@/views/SellerView";

export default function SellerHome() {
  const { user, ready, signIn, signOut } = useSession();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!ready) return <main className="main"><SkeletonCards n={2} /></main>;
  if (user?.role === "seller") return <SellerView shop="me" token="" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (mode === "signup") {
        const r = await api.sellerSignup(username.trim(), password, code.trim());
        authStore.set({ token: r.token, user: r.user });
        window.location.reload();
      } else {
        await signIn("login", username.trim(), password);
        if (authStore.get()?.user.role !== "seller") { await signOut(); setErr("این حساب فروشنده نیست. حساب خریدار از بخش «ورود» عادی است."); }
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <main className="main">
      <header className="sellerbar"><span className="mk"><Icon n="inbox" /></span><div className="grow"><div className="b">ترب‌گرد · فروشنده</div><div className="xs" style={{ opacity: .75 }}>جواب سریع، موجودی درست، مشتری بیشتر</div></div></header>
      <form className="pad stack auth-box" style={{ gap: 14, paddingTop: 14 }} onSubmit={submit} noValidate>
        {user && <Note tone="info" icon="alert">با حساب خریدار «{user.username}» وارد شده‌اید. برای فروشنده بودن با حساب فروشنده وارد شوید.</Note>}
        <Seg label="ورود یا ساخت حساب فروشنده" value={mode} onChange={(m) => { setMode(m); setErr(null); }} options={[["login", "ورود"], ["signup", "ساخت حساب فروشگاه"]]} />
        {mode === "signup" && (
          <div className="stack" style={{ gap: 6 }}>
            <label htmlFor="sl-code" className="sm b">کد فروشگاه</label>
            <div className="field"><input id="sl-code" value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" spellCheck={false} autoCapitalize="none" placeholder="کد یا لینک فروشنده را بچسبانید" /></div>
            <span className="xs faint">کد را از ربات بله یا لینک فروشنده بگیرید. هر فروشگاه یک حساب دارد.</span>
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="sl-user" className="sm b">نام کاربری</label>
          <div className="field"><input id="sl-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} dir="auto" /></div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="sl-pass" className="sm b">رمز عبور</label>
          <div className="field"><input id="sl-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete={mode === "login" ? "current-password" : "new-password"} /></div>
          {mode === "signup" && <span className="xs faint">دست‌کم ۸ حرف.</span>}
        </div>
        {err && <Note tone="bad" icon="alert">{err}</Note>}
        <button className="btn pri block" type="submit" disabled={busy || !username.trim() || !password || (mode === "signup" && !code.trim())}>
          {busy ? <span className="spin" style={{ borderTopColor: "var(--on-accent)" }} /> : null}{mode === "login" ? "ورود" : "ساخت حساب"}
        </button>
        <p className="xs faint center" style={{ margin: 0 }}>خریدار هستید؟ <Link href="/">به صفحهٔ خرید بروید</Link>.</p>
      </form>
    </main>
  );
}
