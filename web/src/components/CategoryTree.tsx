import Link from "next/link";
import { contains, type TreeNode } from "@/lib/tree";

export function CategoryTree({ nodes, active, all }: { nodes: TreeNode[]; active?: string; all: boolean }) {
  const visible = nodes.filter((n) => (all ? n.count : n.files) > 0 || n.slug === active || n.kind === "chat");
  if (!visible.length) return null;
  return (
    <ul className="tree">
      {visible.map((n) => (
        <Node key={n.id} n={n} active={active} all={all} />
      ))}
    </ul>
  );
}

function Node({ n, active, all }: { n: TreeNode; active?: string; all: boolean }) {
  const kids = n.children.filter((c) => (all ? c.count : c.files) > 0 || c.slug === active);
  const icon = n.kind === "chat" ? "📢" : n.kind === "topic" ? "💬" : "";
  const label = (
    <Link href={`/c/${n.slug}${all ? "?all=1" : ""}`} className={`node ${n.slug === active ? "active" : ""}`}>
      <span>
        {icon} {n.name}
      </span>
      <small>{all ? n.count : n.files}</small>
    </Link>
  );
  if (!kids.length) return <li>{label}</li>;
  return (
    <li>
      <details open={n.kind === "chat" || contains(n, active)}>
        <summary>{label}</summary>
        <CategoryTree nodes={kids} active={active} all={all} />
      </details>
    </li>
  );
}
