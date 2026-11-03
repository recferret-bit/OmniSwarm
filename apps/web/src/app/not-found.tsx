import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>This page or request does not exist. <Link href="/">Back to the start</Link>.</p>
    </>
  );
}
