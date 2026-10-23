"use client";
// My missions (canvas S8): the errands in progress and finished, the latest seller answer, how to be told when one arrives.
import Link from "next/link";
import { useState } from "react";
import { fa, minutesAgo } from "@/lib/fa";
import { groupMissions, useMissions } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { useInquiries, useNow } from "@/lib/useInquiries";
import { Icon } from "@/components/Icon";
import { NotifyOptIn } from "@/components/followup";
import { Bidi, Empty } from "@/components/ui";
import { MissionBar, missionHref } from "@/components/mission/chrome";
import { MissionCard } from "@/components/mission/MissionCard";

export default function MissionsView() {
  const { missions, remove, ready } = useMissions();
  const { sid, user } = useSession();
  const inq = useInquiries(sid, { live: false });
  const [tab, setTab] = useState<"active" | "done">("active");
  const now = useNow(60_000);
  const active = missions.filter((m) => !m.done), done = missions.filter((m) => m.done);
  const list = groupMissions(tab === "active" ? active : done);
  const latest = inq.items.filter((i) => i.kind === "ask" && i.status === "answered" && i.answer?.available !== false && i.shop && i.product)
    .sort((a, b) => ((b.answered_at ?? "") > (a.answered_at ?? "") ? 1 : -1))[0];
  const latestMission = latest ? missions.find((m) => m.productId === latest.product!.product_id) : null;

  return (
    <div className="mc">
      <MissionBar />
      <div className="mc-body two" style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: 0, overflowY: "auto", paddingBottom: 32 }}>
        <main className="mc-main mc-pad" style={{ width: "100%", maxWidth: 720, paddingTop: 12, gap: 12 }}>
          {latest && latestMission && now - new Date(latest.answered_at ?? 0).getTime() < 6 * 3600_000 && (
            <Link href={missionHref(latestMission.id, "confirm")} className="notif" role="status">
              <Icon n="bell" /><span className="stack" style={{ gap: 0 }}><b className="sm">{latest.shop!.name} تأیید کرد: موجود</b>
                <span className="xs">{minutesAgo(latest.answered_at)}، <Bidi text={latest.product!.title.slice(0, 30)} /></span></span>
            </Link>
          )}
          <div className="row between">
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>خریدهای من</h1>
            <Link href="/" className="btn sec" style={{ minHeight: 40 }}>خرید تازه</Link>
          </div>
          <div className="seg" role="tablist" aria-label="وضعیت">
            <button role="tab" aria-selected={tab === "active"} className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>{`فعال، ${fa(active.length)}`}</button>
            <button role="tab" aria-selected={tab === "done"} className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>{`تمام‌شده، ${fa(done.length)}`}</button>
          </div>
          {ready && !list.length && (
            <Empty icon="bag" title={tab === "active" ? "خرید فعالی ندارید" : "هنوز خریدی تمام نشده"} action={tab === "active" ? <Link className="btn pri" href="/"><Icon n="spark" s />شروع یک خرید</Link> : undefined}>
              {tab === "active" ? "بنویسید چه می‌خواهید؛ ترب‌گرد تا رسیدن به مغازه کنارتان است." : "وقتی بعد از خرید بگویید کالا بود یا نه، خرید به این بخش می‌آید."}
            </Empty>
          )}
          <div className="stack" style={{ gap: 10 }}>
            {list.map(({ head: m, items }) => (
              <div key={m.id} className="mission-item">
                <MissionCard m={m} count={items.length} />
                <button type="button" className="mission-rm" aria-label="حذف خرید" title="حذف از این دستگاه" onClick={() => { if (confirm(items.length > 1 ? "این خرید و همهٔ کالاهایش از این دستگاه حذف شود؟" : "این خرید از این دستگاه حذف شود؟")) items.forEach((x) => remove(x.id)); }}><Icon n="x" s /></button>
              </div>
            ))}
          </div>
          <div className="mc-card" style={{ padding: 14 }}>
            <div className="b sm">وقتی جواب آمد خبرم کنید</div>
            <NotifyOptIn sid={sid} />
            <div className="xs muted" style={{ lineHeight: 1.7 }}>بدون حساب هم کار می‌کند. {user ? <>وارد شده‌اید؛ خریدها و جواب‌ها روی همهٔ دستگاه‌هایتان می‌ماند.</> : <><Link href="/login" style={{ color: "var(--accent-ink)", fontWeight: 700 }}>ورود اختیاری</Link> تا پاسخ فروشنده‌ها روی گوشی دیگر هم بماند.</>}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
