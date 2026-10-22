"use client";
// Optional account: username + password. Anonymous shopping keeps working; an account keeps the same inquiries,
// seller answers and chat memory on every device. On sign-up, what this device did so far moves into the account.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/Icon";
import { AppBar, Note, Seg } from "@/components/ui";

export default function AuthView({ mode: initial = "login", next }: { mode?: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const { user, signIn, signOut } = useSession();
  const [mode, setMode] = useState<"login" | "signup">(initial);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/missions";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (mode === "signup" && password.length < 8) { setErr("رمز عبور باید دست‌کم ۸ حرف باشد."); return; }
    setBusy(true);
    try {
      await signIn(mode, username.trim(), password);
      router.push(dest);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  if (user) return (
    <main className="main">
      <AppBar title="حساب کاربری" back="/" />
      <div className="pad stack auth-box" style={{ gap: 14, paddingTop: 8 }}>
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ gap: 10 }}><span className="auth-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
            <div className="grow"><div className="b">{user.username}</div><div className="xs muted">خریدها و پاسخ فروشنده‌ها روی هر دستگاهی که وارد شوید همراه شماست.</div></div></div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn pri grow" href="/missions"><Icon n="bag" s />خریدهای من</Link>
            <button className="btn sec" onClick={async () => { await signOut(); router.push("/"); }}>خروج</button>
          </div>
        </div>
      </div>
    </main>
  );

  return (
    <main className="main">
      <AppBar title={mode === "login" ? "ورود" : "ساخت حساب"} back="/" />
      <form className="pad stack auth-box" style={{ gap: 14, paddingTop: 8 }} onSubmit={submit} noValidate>
        <Seg label="ورود یا ثبت‌نام" value={mode} onChange={(m) => { setMode(m); setErr(null); }} options={[["login", "ورود"], ["signup", "ثبت‌نام"]]} />
        <p className="lede" style={{ margin: 0 }}>
          {mode === "login" ? "وارد شوید تا خریدها، استعلام‌ها و پاسخ فروشنده‌ها روی این دستگاه هم بیاید." : "با یک نام کاربری و رمز، خریدهایتان روی هر دستگاهی همراه شماست. استعلام‌هایی که تا حالا روی این دستگاه فرستاده‌اید به حساب منتقل می‌شود."}
        </p>
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="auth-user" className="sm b">نام کاربری</label>
          <div className="field"><input id="auth-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} dir="auto" required minLength={3} maxLength={32} /></div>
          {mode === "signup" && <span className="xs faint">۳ تا ۳۲ حرف؛ حرف، عدد، نقطه، خط تیره یا زیرخط.</span>}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="auth-pass" className="sm b">رمز عبور</label>
          <div className="field">
            <input id="auth-pass" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr"
              autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : 1} maxLength={128} />
            <button type="button" className="btn ghost" style={{ minHeight: 36, paddingInline: 6 }} onClick={() => setShow(!show)} aria-pressed={show}>{show ? "پنهان" : "نمایش"}</button>
          </div>
          {mode === "signup" && <span className="xs faint">دست‌کم ۸ حرف.</span>}
        </div>
        {err && <Note tone="bad" icon="alert">{err}</Note>}
        <button className="btn pri block" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? <span className="spin" style={{ borderTopColor: "var(--on-accent)" }} /> : null}{mode === "login" ? "ورود" : "ساخت حساب"}
        </button>
        <p className="xs faint center" style={{ margin: 0 }}>بدون حساب هم می‌توانید جستجو کنید و استعلام بفرستید.</p>
      </form>
    </main>
  );
}
