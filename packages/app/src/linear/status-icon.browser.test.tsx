import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { LinearStatusIcon } from "./status-icon";

vi.mock("react-native-svg", () => ({ default: "svg", Circle: "circle", Path: "path" }));
vi.stubGlobal("React", React);

const workflowStates = [
  { name: "Backlog", type: "backlog", color: "#bec2c8", progress: 0 },
  { name: "TO DO", type: "unstarted", color: "#e2e2e2", progress: 0 },
  { name: "TO DO Design", type: "unstarted", color: "#eb5757", progress: 0 },
  { name: "In Progress", type: "started", color: "#f2c94c", progress: 0.2 },
  { name: "Ready for review", type: "started", color: "#f2994a", progress: 0.4 },
  { name: "Ready for QA", type: "started", color: "#eb5757", progress: 0.6 },
  { name: "Ready for Release", type: "started", color: "#5e6ad2", progress: 0.8 },
  { name: "Done", type: "completed", color: "#5e6ad2", progress: 0 },
  { name: "Canceled", type: "canceled", color: "#95a2b3", progress: 0 },
  { name: "Duplicate", type: "duplicate", color: "#95a2b3", progress: 0 },
  { name: "Triage", type: "triage", color: "#FC7840", progress: 0 },
];

it("renders the team's status glyphs and colors", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <div>
        {workflowStates.map((state) => (
          <p key={state.name}>
            <LinearStatusIcon state={state} size={24} /> {state.name}
          </p>
        ))}
      </div>,
    ),
  );
  const circles = [...container.querySelectorAll("circle")];
  expect(circles.map((circle) => circle.getAttribute("stroke"))).toEqual(
    workflowStates.map((state) => state.color),
  );
  const started = [...container.querySelectorAll("svg")].slice(3, 7);
  expect(new Set(started.map((svg) => svg.querySelector("path")?.getAttribute("d"))).size).toBe(4);
  await page.screenshot({ path: "/tmp/paseo-linear-statuses.png" });
  act(() => root.unmount());
  container.remove();
});
