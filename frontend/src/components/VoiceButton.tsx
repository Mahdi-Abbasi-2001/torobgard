"use client";
// The microphone: tap, say what you want, tap again (or it stops by itself after 20 seconds). The recording goes to /api/transcribe, comes
// back as text, and is dropped; nothing is stored. If the browser has no microphone access, or the server cannot read the audio, it says so
// and the shopper simply types.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fa } from "@/lib/fa";
import { Icon } from "@/components/Icon";

const MAX_S = 20;
const mime = () => (typeof MediaRecorder === "undefined" ? "" : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "");

export function VoiceButton({ onText, className = "iconbtn", disabled }: { onText: (t: string) => void; className?: string; disabled?: boolean }) {
  const [st, setSt] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } if (rec.current && rec.current.state !== "inactive") rec.current.stop(); };
  const start = async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr("این مرورگر ضبط صدا را پشتیبانی نمی‌کند؛ بنویسید."); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const type = mime();
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        s.getTracks().forEach((t) => t.stop());
        setSt("busy");
        try { const { text } = await api.transcribe(new Blob(chunks, { type: r.mimeType || type || "audio/webm" })); onText(text); }
        catch (e) { setErr((e as Error).message); }
        finally { setSt("idle"); }
      };
      rec.current = r; r.start(); setSt("rec"); setSecs(0);
      timer.current = setInterval(() => setSecs((x) => { if (x + 1 >= MAX_S) { stop(); return x + 1; } return x + 1; }), 1000);
    } catch { setErr("به میکروفون دسترسی نداریم؛ بنویسید یا اجازه بدهید."); setSt("idle"); }
  };

  return (
    <span className="vb">
      <button type="button" className={`${className} vb-btn ${st}`} disabled={disabled || st === "busy"} aria-label={st === "rec" ? "پایان ضبط" : "گفتن با صدا"} aria-pressed={st === "rec"} onClick={() => (st === "rec" ? stop() : start())}>
        {st === "busy" ? <span className="spin" /> : <Icon n="mic" />}
      </button>
      {st === "rec" && <span className="vb-note" role="status"><i />دارم گوش می‌دهم… {fa(secs)} ثانیه؛ تمام شد؟ دوباره بزن</span>}
      {st === "busy" && <span className="vb-note" role="status">دارم می‌نویسم…</span>}
      {err && <span className="vb-note bad" role="alert">{err}</span>}
    </span>
  );
}
