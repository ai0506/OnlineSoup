import Link from "next/link";

export default function NotFound() {
  return (
    <section className="form-card">
      <p className="eyebrow">404</p>
      <h1>没有找到这个房间</h1>
      <p className="lead">请检查房间码是否正确，或者向房主索取新的链接。</p>
      <Link className="button" href="/">
        返回大厅
      </Link>
    </section>
  );
}
