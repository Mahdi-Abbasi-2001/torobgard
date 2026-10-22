import type { Mission, View } from "@/lib/mission";
import type { MissionStatus } from "@/lib/useMissionStatus";
import type { SlotsPatch } from "./SlotsSheet";

/** What every stage gets from the mission screen. */
export interface StageProps {
  m: Mission; view: View; status: MissionStatus;
  set: (p: Partial<Mission> | ((m: Mission) => Partial<Mission>)) => void;
  go: (v: View, replace?: boolean) => void;
  patchSlots: (p: SlotsPatch) => void;
}
