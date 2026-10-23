"use client";
// The in-app voice call, seller side. The buyer's agent "rings" the shop's open inbox page: the seller picks up, hears the question read aloud
// (the browser's own speech voice, free; with no Persian voice on the device it is shown as subtitles instead), says the answer, checks the
// text, and sends it. The answer goes through the same reader as a typed reply, so a missing price is asked once more, out loud.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type Inquiry } from "@/lib/api";
import { fa } from "@/lib/fa";
import { Icon } from "@/components/Icon";
import { VoiceButton } from "@/components/VoiceButton";
import { Bidi } from "@/components/ui";

const persianVoice = () => (typeof speechSynthesis === "undefined" ? undefined : speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("fa")));

/** Say it aloud; resolves when finished (or at once when the device has no Persian voice). Returns whether it was actually spoken. */
function say(text: string): Promise<boolean> {
  return new Promise((res) => {
    const v = persianVoice();
    if (!v) return res(false);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = 0.95;
    u.onend = () => res(true); u.onerror = () => res(false);
    speechSynthesis.speak(u);
  });
}

function useRing(on: boolean) {
  useEffect(() => {
    if (!on || typeof AudioContext === "undefined") return;
    let ctx: AudioContext | null = null, t: ReturnType<typeof setInterval> | null = null;
    try {
      ctx = new AudioContext();
      const beep = () => { if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 440; g.gain.value = 0.08; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35); };
      beep(); t = setInterval(beep, 1600);
    } catch { /* no sound: the screen still rings */ }
    return () => { if (t) clearInterval(t); ctx?.close().catch(() => {}); };
  }, [on]);
}

export function CallScreen({ i, shop, token, onDone, onDecline }: { i: Inquiry; shop: string; token: string; onDone: (msg: string) => void; onDecline: () => void }) {
  const [phase, setPhase] = useState<"ring" | "talk">("ring");
  const [line, setLine] = useState("");
  const [text, setText] = useState("");
  const [spoken, setSpoken] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  // spoken line: short, only the questions (the written message also carries the greeting and the "we messaged you first" note)
  const first = useRef(`${(i.product?.title ?? "یک کالا").slice(0, 70)}. ${i.questions.map((x) => x.text.replace(/[؟?]+$/, "")).join("؟ ")}؟`);
  useRing(phase === "ring");
  useEffect(() => { if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices(); return () => { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }; }, []);

  const speak = async (t: string) => { setLine(t); setSpeaking(true); const ok = await say(t); setSpoken(ok); setSpeaking(false); };
  const pickUp = () => { setPhase("talk"); void speak(`سلام، از ترب‌گرد تماس می‌گیرم، از طرف یک خریدار. دربارهٔ ${first.current}`); };
  const send = useMutation({
    mutationFn: () => api.sellerReply(shop, token, i.id, text),
    onSuccess: async (r) => {
      setText("");
      if (r.follow_up) { void speak(r.follow_up); return; }
      await say("ممنون از شما. خداحافظ.");
      onDone(`مشتری می‌بیند: ${r.inquiry.answer?.summary ?? r.inquiry.label}`);
    },
  });

  return (
    <div className="call-ov" role="dialog" aria-modal="true" aria-label="تماس ترب‌گرد">
      <div className="call-card">
        <div className="call-av"><Icon n="phone" /></div>
        <div className="xs" style={{ opacity: .7 }}>{phase === "ring" ? "تماس ورودی" : speaking ? "دستیار دارد می‌پرسد…" : "نوبت شماست"}</div>
        <div className="h3">دستیار ترب‌گرد</div>
        <div className="sm" style={{ opacity: .85 }}><Bidi text={i.product?.title} /></div>
        {phase === "ring" ? (
          <>
            <div className="sm" style={{ opacity: .8 }}>یک خریدار می‌خواهد بداند این کالا دارید یا نه.</div>
            <div className="row" style={{ gap: 12, marginTop: 8 }}>
              <button type="button" className="bigbtn ok" onClick={pickUp}><Icon n="phone" />جواب می‌دهم</button>
              <button type="button" className="bigbtn no" onClick={onDecline}><Icon n="x" />الان نه</button>
            </div>
          </>
        ) : (
          <>
            <div className="call-sub" aria-live="polite">{line}</div>
            {!spoken && <div className="xs" style={{ opacity: .7 }}>این دستگاه صدای فارسی ندارد؛ سؤال را بخوانید و جواب بدهید.</div>}
            <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
              <VoiceButton className="iconbtn call-mic" disabled={speaking || send.isPending} onText={(t) => setText((x) => (x ? `${x} ${t}` : t))} />
              <input className="call-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="دکمهٔ میکروفون را بزنید و جواب را بگویید (یا اینجا بنویسید)" aria-label="جواب شما" />
            </div>
            <div className="xs" style={{ opacity: .65 }}>متن را بخوانید و اگر اشتباه بود درستش کنید، بعد بفرستید.</div>
            {send.isError && <div className="xs" style={{ color: "#ff9d9d" }}>{(send.error as Error).message}</div>}
            <div className="row" style={{ gap: 12, marginTop: 4 }}>
              <button type="button" className="bigbtn ok" disabled={!text.trim() || send.isPending || speaking} onClick={() => send.mutate()}>{send.isPending ? <span className="spin" /> : <Icon n="send" />}ارسال جواب</button>
              <button type="button" className="bigbtn no" onClick={onDecline}><Icon n="x" />قطع</button>
            </div>
            <span className="xs" style={{ opacity: .55 }}>{fa("مدت مهلت تماس کوتاه است؛ اگر جواب ندهید، به مشتری گفته می‌شود پاسخی نیامد.")}</span>
          </>
        )}
      </div>
    </div>
  );
}
