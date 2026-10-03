import { P, type IconName } from './icon-paths';

/** Same markup as the prototype's I(k): <svg class="i" viewBox="0 0 24 24">…</svg> */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ? `i ${className}` : 'i'} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: P[name] }} />;
}

/** An icon that is not in P (written inline in the prototype's HTML). */
export function RawIcon({ d }: { d: string }) {
  return <svg className="i" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: d }} />;
}
