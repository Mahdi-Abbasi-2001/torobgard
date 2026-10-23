"use client";
// One mission, any stage (canvas F2–F9 / D2–D5). The screen is chosen from `?s=`; without it, from how far the mission has got:
// no product → decide, no questions sent → find, questions sent → confirm, held / on the way → go, visit reported → done.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useMission, STAGE_OF, type View } from "@/lib/mission";
import { useSession } from "@/lib/session";
import { useMissionStatus } from "@/lib/useMissionStatus";
import { Empty } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { MissionBar, missionHref } from "@/components/mission/chrome";
import type { SlotsPatch } from "@/components/mission/SlotsSheet";
import type { StageProps } from "@/components/mission/stage";
import DecideStage from "@/components/mission/DecideStage";
import FindStage from "@/components/mission/FindStage";
import ConfirmStage from "@/components/mission/ConfirmStage";
import GoStage from "@/components/mission/GoStage";
import DoneStage from "@/components/mission/DoneStage";
import AutopilotStage from "@/components/mission/AutopilotStage";

const VIEWS: View[] = ["decide", "find", "compare", "confirm", "go", "done"];

export default function MissionView({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { m, ready, set } = useMission(id);
  const { update } = useSession();
  const status = useMissionStatus(m);

  // the session carries place / when / how to every existing component (shop cards, travel times); the mission owns them
  const placeKey = m ? `${m.place.lat},${m.place.lon},${m.place.label}` : "";
  useEffect(() => {
    if (!m) return;
    update((s) => (s.place.lat === m.place.lat && s.place.lon === m.place.lon && s.place.label === m.place.label && s.when === m.when && s.mode === m.mode
      ? s : { ...s, place: m.place, when: m.when, mode: m.mode, locationAsked: s.locationAsked || m.place.source !== "default" }));
  }, [placeKey, m?.when, m?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((v: View, replace = false) => { const h = missionHref(id, v); if (replace) router.replace(h); else router.push(h); }, [id, router]);
  const patchSlots = useCallback((p: SlotsPatch) => set(p), [set]);

  if (!ready) return <div className="mc"><MissionBar /><div className="mc-body"><div className="mc-center mc-pad" style={{ paddingTop: 20 }}><div className="sk mc-skel" style={{ height: 120 }} /><div className="sk mc-skel" style={{ height: 260 }} /></div></div></div>;
  if (!m) return (
    <div className="mc"><MissionBar />
      <Empty icon="q" title="این خرید روی این دستگاه نیست" action={<Link className="btn pri" href="/"><Icon n="spark" s />خرید تازه</Link>}>خریدها فقط روی دستگاهی که ساخته‌اید می‌مانند. جواب فروشنده‌ها را در «خریدهای من» می‌بینید.</Empty>
    </div>
  );

  const asked = sp.get("s") as View | null;
  const natural: View = status.finished ? "done" : status.stage === 3 ? "go" : status.stage === 2 ? "confirm" : status.stage === 1 ? "find" : "decide";
  // you can go back to any stage you have been through, never ahead of the mission
  const view: View = asked && VIEWS.includes(asked) && STAGE_OF[asked] <= status.stage ? asked : natural;
  const props: StageProps = { m, view, status, set, go, patchSlots };
  // autopilot runs until the shopper sets off (or takes over): the rail links (?s=) always open the normal stage
  if (m.auto && !asked && !m.going && !status.finished) return <AutopilotStage {...props} />;
  return view === "decide" ? <DecideStage {...props} />
    : view === "find" || view === "compare" ? <FindStage {...props} />
    : view === "confirm" ? <ConfirmStage {...props} />
    : view === "go" ? <GoStage {...props} />
    : <DoneStage {...props} />;
}
