"use client";
import Link from "next/link";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="main"><div className="empty" style={{ paddingTop: 120 }}>
      <h2>مشکلی پیش آمد</h2><p>صفحه درست بارگذاری نشد. اتصال را بررسی کنید و دوباره امتحان کنید.</p>
      <div className="row" style={{ gap: 8, justifyContent: "center" }}><button className="btn sec" onClick={reset}>تلاش دوباره</button><Link className="btn pri" href="/">صفحهٔ اصلی</Link></div></div></main>
  );
}
