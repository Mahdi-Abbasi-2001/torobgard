import Link from "next/link";
export default function NotFound() {
  return (
    <main className="main"><div className="empty" style={{ paddingTop: 120 }}>
      <h2>این صفحه پیدا نشد</h2><p>شاید لینک قدیمی است. از صفحهٔ اصلی دوباره شروع کنید.</p>
      <Link className="btn pri" href="/">صفحهٔ اصلی</Link></div></main>
  );
}
