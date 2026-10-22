"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Inquiry } from "@/lib/api";
import { clock, fa } from "@/lib/fa";
import { useSession } from "@/lib/session";
import { useInquiries } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { AppBar, BottomNav, Bidi, Empty, ErrorState, Seg, SkeletonCards, Thumb } from "@/components/ui";

export default function MineView() {
  const { sid, user } = useSession();
  const inq = useInquiries(sid);
  const [picked, setTab] = useState<"active" | "done" | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, Inquiry[]>();
    inq.items.forEach((i) => { const k = i.product?.product_id ?? "?"; m.set(k, [...(m.get(k) ?? []), i]); });
    return [...m.values()].map((g) => ({ g, active: g.some((i) => i.status === "sent" || i.status === "delivered"), last: g[0].answered_at ?? g[0].created_at }))
      .sort((a, b) => b.last.localeCompare(a.last));
  }, [inq.items]);
  const act = groups.filter((x) => x.active), done = groups.filter((x) => !x.active);
  const tab = picked ?? (act.length || !done.length ? "active" : "done"); // open on whichever has something
  const list = tab === "active" ? act : done;
  const c = (g: Inquiry[], s: string[]) => g.filter((i) => s.includes(i.status)).length;

  return (
    <main className="main has-nav">
      <AppBar title="خریدهای من" back={false} />
      <div className="pad" style={{ paddingBottom: 10 }}>
        {user
          ? <div className="card row" style={{ padding: "10px 14px", gap: 10 }}><span className="auth-avatar" style={{ width: 32, height: 32 }}>{user.username.slice(0, 1).toUpperCase()}</span>
              <span className="grow sm">وارد شده‌اید: <b><bdi>{user.username}</bdi></b></span><Link className="btn ghost" style={{ minHeight: 36 }} href="/login">حساب</Link></div>
          : <Link href="/login?next=/mine" className="card row" style={{ padding: "12px 14px", gap: 10 }}><Icon n="lock" s />
              <span className="grow sm"><b>ورود یا ثبت‌نام</b><span className="xs muted" style={{ display: "block" }}>تا خریدها و پاسخ فروشنده‌ها روی هر دستگاهی همراهتان باشد.</span></span><Icon n="fwd" s /></Link>}
      </div>
      {inq.isLoading && <SkeletonCards n={3} />}
      {inq.isError && <ErrorState error={inq.error} retry={() => inq.refetch()} />}
      {inq.data && !groups.length && (
        <div style={{ paddingTop: 60 }}>
          <Empty icon="bag" title="هنوز از فروشگاهی نپرسیده‌اید" action={<Link className="btn pri" href="/"><Icon n="search" s />شروع یک خرید</Link>}>
            وقتی از فروشگاه‌ها استعلام بگیرید، پاسخ‌ها و برنامهٔ بازدید اینجا جمع می‌شود.
          </Empty>
        </div>
      )}
      {groups.length > 0 && (
        <div className="pad stack mine-list" style={{ gap: 10 }}>
          <Seg label="وضعیت" value={tab} onChange={setTab} options={[["active", `فعال ${fa(act.length)}`], ["done", `تمام‌شده ${fa(done.length)}`]]} />
          {!list.length && <p className="sm muted center">{tab === "active" ? "استعلام در انتظاری ندارید." : "هنوز استعلامی تمام نشده."}</p>}
          {list.map(({ g }) => {
            const p = g[0].product;
            return (
              <Link key={g[0].id} href={`/track?product=${p?.product_id}`} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="row" style={{ gap: 10 }}>
                  <Thumb src={p?.image} alt="" size={44} />
                  <div className="grow"><div className="b sm"><Bidi text={p?.title} /></div><div className="xs muted">{clock(g[g.length - 1].created_at)} · {fa(g.length)} استعلام</div></div>
                  <Icon n="fwd" s />
                </div>
                <div className="wrapr">
                  {c(g, ["answered"]) > 0 && <span className="st answered">{fa(c(g, ["answered"]))} پاسخ</span>}
                  {c(g, ["unavailable"]) > 0 && <span className="st unavailable">{fa(c(g, ["unavailable"]))} ناموجود</span>}
                  {c(g, ["sent", "delivered"]) > 0 && <span className="st sent">{fa(c(g, ["sent", "delivered"]))} در انتظار</span>}
                  {c(g, ["no_reply"]) > 0 && <span className="st no_reply">{fa(c(g, ["no_reply"]))} بی‌پاسخ</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <BottomNav badge={inq.items.filter((i) => i.status === "answered").length} />
    </main>
  );
}
