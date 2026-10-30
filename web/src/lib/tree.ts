import type { Category } from "./api";

export type TreeNode = Category & { children: TreeNode[] };

export function buildTree(cats: Category[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  for (const c of cats) map.set(c.id, { ...c, children: [] });
  const roots: TreeNode[] = [];
  for (const n of map.values()) {
    const p = n.parentId != null ? map.get(n.parentId) : undefined;
    (p ? p.children : roots).push(n);
  }
  return roots;
}

export function pathOf(cats: Category[], id: number): Category[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: Category[] = [];
  let n = byId.get(id);
  while (n && out.length < 32) {
    out.unshift(n);
    n = n.parentId != null ? byId.get(n.parentId) : undefined;
  }
  return out;
}

export const contains = (n: TreeNode, slug?: string): boolean => !!slug && (n.slug === slug || n.children.some((c) => contains(c, slug)));
