/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { emptyChangeBreakdown } from "@getpaseo/protocol/diff-stat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { ChangeStats } from "./change-stats";

void testI18n;

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8 },
    fontSize: { sm: 13 },
    fontWeight: { normal: "400" },
    colors: {
      foregroundMuted: "#aaa",
      statusSuccess: "#0f0",
      statusDanger: "#f00",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
}));

const SERVER_ID = "change-stats";

function setFeatures(features: Record<string, boolean>): void {
  act(() => {
    useSessionStore.getState().updateSessionServerInfo(SERVER_ID, {
      serverId: SERVER_ID,
      hostname: null,
      version: null,
      features,
    });
  });
}

function mixedBreakdown() {
  const breakdown = emptyChangeBreakdown();
  breakdown.code = { additions: 2, deletions: 1 };
  breakdown.config = { additions: 7, deletions: 3 };
  return breakdown;
}

describe("ChangeStats capability gate", () => {
  beforeEach(() => {
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    setFeatures({ changeBreakdown: true });
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER_ID);
  });

  it("hides the production group when the host stops advertising the feature and restores it after", () => {
    render(
      <ChangeStats additions={9} deletions={4} breakdown={mixedBreakdown()} serverId={SERVER_ID} />,
    );
    expect(screen.getByLabelText("Code").textContent).toBe("+2-1");
    expect(screen.getByLabelText("Total").textContent).toBe("+9-4");

    setFeatures({});
    expect(screen.queryByLabelText("Code")).toBeNull();
    expect(screen.getByLabelText("Total").textContent).toBe("+9-4");

    setFeatures({ changeBreakdown: true });
    expect(screen.getByLabelText("Code").textContent).toBe("+2-1");
    expect(screen.getByLabelText("Total").textContent).toBe("+9-4");
  });
});
