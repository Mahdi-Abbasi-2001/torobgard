"use client";
// My missions (canvas S8): the errands in progress and finished, the latest seller answer, how to be told when one arrives.
import Link from "next/link";
import { useState } from "react";
import { fa, minutesAgo } from "@/lib/fa";
import { useMissions } from "@/lib/mission";
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
  const list = tab === "active" ? active : done;
  const latest = inq.items.filter((i) => i.kind === "ask" && i.status === "answered" && i.answer?.available !== false && i.shop && i.product)
    .sort((a, b) => ((b.answered_at ?? "") > (a.answered_at ?? "") ? 1 : -1))[0];
  const latestMission = latest ? missions.find((m) => m.productId === latest.product!.product_id) : null;

  return (
    <div className="mc">
      <MissionBar />
      <div className="mc-body two" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <main className="mc-main mc-pad" style={{ width: "100%", maxWidth: 720, paddingTop: 12, gap: 12 }}>
          {latest && latestMission && now - new Date(latest.answered_at ?? 0).getTime() < 6 * 3600_000 && (
            <Link href={missionHref(latestMission.id, "confirm")} className="notif" role="status">
              <Icon n="bell" /><span className="stack" style={{ gap: 0 }}><b className="sm">{latest.shop!.name} تأیید کرد: موجود</b>
                <span className="xs">{minutesAgo(latest.answered_at)}، <Bidi text={latest.product!.title.slice(0, 30)} /></span></span>
            </Link>
          )}
          <div className="row between">
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>مأموریت‌های من</h1>
            <Link href="/" className="btn sec" style={{ minHeight: 40 }}>مأموریت تازه</Link>
          </div>
          <div className="seg" role="tablist" aria-label="وضعیت">
            <button role="tab" aria-selected={tab === "active"} className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>{`فعال، ${fa(active.length)}`}</button>
            <button role="tab" aria-selected={tab === "done"} className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>{`تمام‌شده، ${fa(done.length)}`}</button>
          </div>
          {ready && !list.length && (
            <Empty icon="bag" title={tab === "active" ? "مأموریت فعالی ندارید" : "هنوز مأموریتی تمام نشده"} action={tab === "active" ? <Link className="btn pri" href="/"><Icon n="spark" s />شروع یک مأموریت</Link> : undefined}>
              {tab === "active" ? "بنویسید دنبال چه هستید؛ ترب‌گرد تا رسیدن به مغازه همراهتان است." : "وقتی بعد از خرید بگویید کالا بود یا نه، مأموریت اینجا می‌آید."}
            </Empty>
          )}
          <div className="stack" style={{ gap: 10 }}>
            {list.map((m) => (
              <div key={m.id} className="mission-item">
                <MissionCard m={m} />
                <button type="button" className="mission-rm" aria-label="حذف مأموریت" title="حذف از این دستگاه" onClick={() => { if (confirm("این مأموریت از این دستگاه حذف شود؟")) remove(m.id); }}><Icon n="x" s /></button>
              </div>
            ))}
          </div>
          <div className="mc-card" style={{ padding: 14 }}>
            <div className="b sm">خبرم کن</div>
            <NotifyOptIn sid={sid} />
            <div className="xs muted" style={{ lineHeight: 1.7 }}>بدون حساب هم کار می‌کند. {user ? <>وارد شده‌اید: مأموریت‌ها و پاسخ‌ها روی همهٔ دستگاه‌هایتان می‌ماند.</> : <><Link href="/login" style={{ color: "var(--accent-ink)", fontWeight: 700 }}>ورود اختیاری</Link> تا پاسخ فروشنده‌ها روی گوشی دیگر هم بماند.</>}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
