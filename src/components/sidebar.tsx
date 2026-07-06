'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Settings,
  Zap,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Sessions', icon: LayoutDashboard },
  { href: '/daily', label: 'Daily', icon: CalendarDays },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** Folders this deep or deeper start collapsed by default; shallower auto-expand. */
const DEFAULT_EXPAND_DEPTH = 2;
/** Persisted per-folder expand/collapse overrides (path → expanded?). */
const EXPAND_STATE_KEY = 'open-session:project-expand';

interface ProjectSummary {
  cwd: string;
  openCount: number;
  lastActivity: string;
}

interface TreeNode {
  /** Display label — may span several path segments after compaction (e.g. "Users/hanyuyang") */
  label: string;
  /** Actual cwd prefix used for filtering (?project=…) */
  path: string;
  /** A session folder lives exactly at this path */
  isProject: boolean;
  /** Aggregate open-session count across this node's subtree */
  openCount: number;
  /** Most recent activity (ms) across the subtree — drives recency ordering */
  lastActivity: number;
  children: TreeNode[];
}

/** Split a cwd into segments, each carrying the actual cwd prefix up to it (native separators preserved). */
function segmentsOf(cwd: string): { seg: string; path: string }[] {
  const out: { seg: string; path: string }[] = [];
  let i = 0;
  const n = cwd.length;
  while (i < n) {
    while (i < n && (cwd[i] === '/' || cwd[i] === '\\')) i++;
    const start = i;
    while (i < n && cwd[i] !== '/' && cwd[i] !== '\\') i++;
    if (i > start) out.push({ seg: cwd.slice(start, i), path: cwd.slice(0, i) });
  }
  return out;
}

interface MutableNode {
  label: string;
  path: string;
  isProject: boolean;
  ownOpen: number;
  ownActivity: number;
  children: Map<string, MutableNode>;
}

function newNode(label: string, path: string): MutableNode {
  return { label, path, isProject: false, ownOpen: 0, ownActivity: 0, children: new Map() };
}

/** Fold a node's open count + activity over its whole subtree. */
function finalize(node: MutableNode): TreeNode {
  const children = [...node.children.values()].map(finalize);
  let openCount = node.ownOpen;
  let lastActivity = node.ownActivity;
  for (const c of children) {
    openCount += c.openCount;
    lastActivity = Math.max(lastActivity, c.lastActivity);
  }
  return { label: node.label, path: node.path, isProject: node.isProject, openCount, lastActivity, children };
}

/** VS Code-style compaction: merge a non-project node with its single child into one row. */
function compact(node: TreeNode): TreeNode {
  let current = node;
  while (current.children.length === 1 && !current.isProject) {
    const child = current.children[0];
    current = { ...child, label: `${current.label}/${child.label}` };
  }
  return { ...current, children: current.children.map(compact) };
}

function buildForest(projects: ProjectSummary[]): TreeNode[] {
  const root = newNode('', '');
  let rootProject: ProjectSummary | null = null;

  for (const p of projects) {
    const segs = segmentsOf(p.cwd);
    if (segs.length === 0) {
      rootProject = p; // cwd is the filesystem root ("/") — render as its own top-level leaf
      continue;
    }
    let cursor = root;
    segs.forEach((s, idx) => {
      let node = cursor.children.get(s.seg);
      if (!node) {
        node = newNode(s.seg, s.path);
        cursor.children.set(s.seg, node);
      }
      if (idx === segs.length - 1) {
        node.isProject = true;
        node.ownOpen = p.openCount;
        node.ownActivity = new Date(p.lastActivity).getTime();
      }
      cursor = node;
    });
  }

  const roots = [...root.children.values()].map(finalize).map(compact);

  if (rootProject) {
    roots.push({
      label: rootProject.cwd,
      path: rootProject.cwd,
      isProject: true,
      openCount: rootProject.openCount,
      lastActivity: new Date(rootProject.lastActivity).getTime(),
      children: [],
    });
  }

  return roots;
}

function byRecency(a: TreeNode, b: TreeNode) {
  return b.lastActivity - a.lastActivity;
}

/** Every node that has children — the set "expand all" / "collapse all" act on. */
function collectExpandablePaths(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length > 0) {
      acc.push(n.path);
      collectExpandablePaths(n.children, acc);
    }
  }
  return acc;
}

function loadExpandState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(EXPAND_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveExpandState(overrides: Record<string, boolean>) {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(EXPAND_STATE_KEY, JSON.stringify(overrides));
  } catch {
    /* quota exceeded, ignore */
  }
}

function projectLeaf(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function rowStyle(active: boolean) {
  return {
    backgroundColor: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  };
}

function hoverIn(active: boolean) {
  return (e: React.MouseEvent<HTMLElement>) => {
    if (!active) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
  };
}

function hoverOut(active: boolean) {
  return (e: React.MouseEvent<HTMLElement>) => {
    if (!active) e.currentTarget.style.backgroundColor = 'transparent';
  };
}

function CountBadge({ count, active }: { count: number; active: boolean }) {
  if (count <= 0) return null;
  return (
    <span className="text-[11px] tabular-nums" style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>
      {count}
    </span>
  );
}

function TreeRow({
  node,
  depth,
  isExpanded,
  onToggle,
  activeProject,
}: {
  node: TreeNode;
  depth: number;
  isExpanded: (path: string, depth: number) => boolean;
  onToggle: (path: string, depth: number) => void;
  activeProject: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && isExpanded(node.path, depth);
  const active = activeProject === node.path;
  const Icon = hasChildren ? (expanded ? FolderOpen : Folder) : Folder;

  return (
    <>
      <div
        className="flex items-center rounded-md transition-colors"
        style={{ ...rowStyle(active), marginLeft: depth * 11 }}
        onMouseEnter={hoverIn(active)}
        onMouseLeave={hoverOut(active)}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.path, depth)}
            className="flex items-center justify-center w-5 h-7 shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={13}
              style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Link
          href={`/?project=${encodeURIComponent(node.path)}`}
          title={node.path}
          className="flex items-center gap-2 flex-1 min-w-0 py-1.5 pr-2 text-[13px]"
        >
          <Icon size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span className="flex-1 truncate">{node.label}</span>
          <CountBadge count={node.openCount} active={active} />
        </Link>
      </div>
      {expanded &&
        [...node.children].sort(byRecency).map(child => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            isExpanded={isExpanded}
            onToggle={onToggle}
            activeProject={activeProject}
          />
        ))}
    </>
  );
}

/**
 * Projects = navigation by container (working directory), shown as a folder
 * tree that mirrors the real path hierarchy. Reads the active project from the
 * URL (?project=…) so it stays decoupled from the session list, deep-linkable,
 * and refresh-safe. A parent folder filters its whole subtree; a leaf filters
 * itself. Searching falls back to a flat matched list.
 */
function SidebarProjects() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProject = searchParams.get('project');
  const onSessions = pathname === '/';
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState('');
  // path → expanded? — overrides the depth-based default; persisted across refresh
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setOverrides(loadExpandState());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveExpandState(overrides);
  }, [overrides, loaded]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/projects')
      .then(res => (res.ok ? res.json() : { projects: [] }))
      .then(data => {
        if (!cancelled) setProjects(data.projects || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Refetch when navigating (e.g. after closing sessions changes counts)
  }, [pathname]);

  const forest = useMemo(() => buildForest(projects).sort(byRecency), [projects]);

  const query = filter.trim().toLowerCase();
  const matches = query ? projects.filter(p => p.cwd.toLowerCase().includes(query)) : [];
  const allActive = onSessions && !activeProject;
  const hasTree = forest.some(node => node.children.length > 0);

  const isExpanded = (path: string, depth: number) =>
    path in overrides ? overrides[path] : depth < DEFAULT_EXPAND_DEPTH;

  const toggle = (path: string, depth: number) =>
    setOverrides(prev => ({ ...prev, [path]: !(path in prev ? prev[path] : depth < DEFAULT_EXPAND_DEPTH) }));

  const setAll = (expanded: boolean) =>
    setOverrides(prev => {
      const next = { ...prev };
      for (const path of collectExpandablePaths(forest)) next[path] = expanded;
      return next;
    });

  return (
    <div
      className="flex-1 flex flex-col min-h-0 px-3 py-3 border-t"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex items-center justify-between px-2.5 mb-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-tertiary)' }}>
          Projects
        </p>
        {hasTree && !query && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setAll(true)}
              title="Expand all"
              aria-label="Expand all"
              className="flex items-center justify-center w-5 h-5 rounded transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <ChevronsUpDown size={13} />
            </button>
            <button
              onClick={() => setAll(false)}
              title="Collapse all"
              aria-label="Collapse all"
              className="flex items-center justify-center w-5 h-5 rounded transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <ChevronsDownUp size={13} />
            </button>
          </div>
        )}
      </div>

      <Link
        href="/"
        className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors"
        style={rowStyle(allActive)}
        onMouseEnter={hoverIn(allActive)}
        onMouseLeave={hoverOut(allActive)}
      >
        <FolderOpen size={16} />
        All projects
      </Link>

      {projects.length > 8 && (
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter projects..."
          className="mt-2 w-full px-2.5 py-1 rounded-md text-[12px] border outline-none transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = 'var(--accent)';
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
          }}
        />
      )}

      <div className="mt-1 flex-1 overflow-y-auto space-y-0.5">
        {projects.length === 0 ? (
          <p className="px-2.5 py-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            No projects yet
          </p>
        ) : query ? (
          // Search mode: flat matched list, leaf name + full path on hover
          matches.length === 0 ? (
            <p className="px-2.5 py-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              No match
            </p>
          ) : (
            matches.map(project => {
              const active = onSessions && activeProject === project.cwd;
              return (
                <Link
                  key={project.cwd}
                  href={`/?project=${encodeURIComponent(project.cwd)}`}
                  title={project.cwd}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors"
                  style={rowStyle(active)}
                  onMouseEnter={hoverIn(active)}
                  onMouseLeave={hoverOut(active)}
                >
                  <Folder size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                  <span className="flex-1 truncate">{projectLeaf(project.cwd)}</span>
                  <CountBadge count={project.openCount} active={active} />
                </Link>
              );
            })
          )
        ) : (
          forest.map(node => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              isExpanded={isExpanded}
              onToggle={toggle}
              activeProject={activeProject}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 h-screen flex flex-col border-r"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent)' }}>
          <Zap size={16} className="text-white" />
        </div>
        <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Open Session
        </span>
      </div>

      <nav className="px-3 py-3 space-y-0.5">
        {navItems.map(item => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors"
              style={{
                backgroundColor: isActive ? 'var(--bg-active)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <item.icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Suspense fallback={<div className="flex-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />}>
        <SidebarProjects />
      </Suspense>

      <div className="px-4 py-3 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
        v0.1.0
      </div>
    </aside>
  );
}
