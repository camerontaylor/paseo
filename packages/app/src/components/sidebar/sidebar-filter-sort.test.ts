import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  filterAndSortSidebarProjects,
  normalizeSidebarQuery,
  sortSidebarWorkspaces,
  workspaceMatchesSidebarQuery,
} from "./sidebar-filter-sort";

function workspace(id: string, name: string, projectName: string, activity: string) {
  const placement = {
    workspaceKey: id,
    name,
    projectName,
  } as SidebarWorkspacePlacement;
  const entry = {
    ...placement,
    title: name,
    lastActivityAt: new Date(activity),
    lastMessageAt: new Date(activity),
    lastUserMessageAt: new Date(activity),
  } as SidebarWorkspaceEntry;
  return { placement, entry };
}

function projectWorkspaceKeys(project: SidebarProjectEntry): [string, string[]] {
  return [project.viewKey, project.workspaces.map((item) => item.workspaceKey)];
}

describe("sidebar local filtering and sorting", () => {
  const older = workspace("older", "Landing page", "Ideaflow", "2026-09-25T00:00:00Z");
  const newer = workspace("newer", "Sign-in repair", "Ideaflow", "2026-09-29T00:00:00Z");
  const other = workspace("other", "Queue review", "Paseo", "2026-09-27T00:00:00Z");
  const entries = new Map([older, newer, other].map(({ entry }) => [entry.workspaceKey, entry]));
  const projects = [
    {
      viewKey: "ideaflow",
      projectName: "Ideaflow",
      workspaces: [older.placement, newer.placement],
    },
    { viewKey: "paseo", projectName: "Paseo", workspaces: [other.placement] },
  ] as SidebarProjectEntry[];

  it("matches session titles and project names while keeping the project grouping", () => {
    expect(workspaceMatchesSidebarQuery(newer.entry, normalizeSidebarQuery("  SIGN-IN  "))).toBe(
      true,
    );
    expect(
      filterAndSortSidebarProjects({
        projects,
        entries,
        query: normalizeSidebarQuery("paseo"),
        mode: "manual",
      }).map(projectWorkspaceKeys),
    ).toEqual([["paseo", ["other"]]]);
    expect(
      filterAndSortSidebarProjects({
        projects,
        entries,
        query: normalizeSidebarQuery("sign-in"),
        mode: "manual",
      }).map(projectWorkspaceKeys),
    ).toEqual([["ideaflow", ["newer"]]]);
  });

  it("sorts by agent activity or title without mutating the manual order", () => {
    const manual = projects[0].workspaces;
    expect(
      sortSidebarWorkspaces(manual, entries, "recent").map((item) => item.workspaceKey),
    ).toEqual(["newer", "older"]);
    expect(
      sortSidebarWorkspaces(manual, entries, "title").map((item) => item.workspaceKey),
    ).toEqual(["older", "newer"]);
    expect(manual.map((item) => item.workspaceKey)).toEqual(["older", "newer"]);
  });

  it("orders project groups by their latest chat while sorting chats within each group", () => {
    const result = filterAndSortSidebarProjects({
      projects: [projects[1], projects[0]],
      entries,
      query: "",
      mode: "recent",
    });
    expect(result.map(projectWorkspaceKeys)).toEqual([
      ["ideaflow", ["newer", "older"]],
      ["paseo", ["other"]],
    ]);
    expect(projects.map(projectWorkspaceKeys)).toEqual([
      ["ideaflow", ["older", "newer"]],
      ["paseo", ["other"]],
    ]);
  });

  it("keeps empty and equally recent projects in manual order", () => {
    const empty: SidebarProjectEntry = {
      ...projects[0],
      viewKey: "empty",
      projectName: "Empty",
      workspaces: [],
    };
    const sameTime = workspace("same", "Another queue review", "Other", "2026-09-27T00:00:00Z");
    const tiedProject = {
      viewKey: "other-project",
      projectName: "Other",
      workspaces: [sameTime.placement],
    } as SidebarProjectEntry;
    const result = filterAndSortSidebarProjects({
      projects: [empty, tiedProject, projects[1], projects[0]],
      entries: new Map([...entries, [sameTime.entry.workspaceKey, sameTime.entry]]),
      query: "",
      mode: "recent",
    });
    expect(result.map((project) => project.viewKey)).toEqual([
      "ideaflow",
      "other-project",
      "paseo",
      "empty",
    ]);
  });

  it("sorts project groups and their chats by title", () => {
    const result = filterAndSortSidebarProjects({
      projects: [projects[1], projects[0]],
      entries,
      query: "",
      mode: "title",
    });
    expect(result.map(projectWorkspaceKeys)).toEqual([
      ["ideaflow", ["older", "newer"]],
      ["paseo", ["other"]],
    ]);
  });
});

it("distinguishes your messages from replies and ignores metadata timestamps with stable ties", () => {
  const a = workspace("a", "Zulu", "Project", "2026-01-02T00:00:00Z");
  const b = workspace("b", "Alpha", "Project", "2026-01-03T00:00:00Z");
  a.entry.lastMessageAt = new Date("2026-01-04T00:00:00Z");
  a.entry.lastActivityAt = new Date("2026-02-01T00:00:00Z");
  const entries = new Map([a, b].map(({ entry }) => [entry.workspaceKey, entry]));
  const placements = [a.placement, b.placement];
  expect(sortSidebarWorkspaces(placements, entries, "recent").map((x) => x.workspaceKey)).toEqual([
    "a",
    "b",
  ]);
  expect(sortSidebarWorkspaces(placements, entries, "user").map((x) => x.workspaceKey)).toEqual([
    "b",
    "a",
  ]);
  b.entry.lastMessageAt = a.entry.lastMessageAt;
  b.entry.lastActivityAt = new Date("2027-01-01T00:00:00Z");
  expect(sortSidebarWorkspaces(placements, entries, "recent").map((x) => x.workspaceKey)).toEqual([
    "a",
    "b",
  ]);
});
