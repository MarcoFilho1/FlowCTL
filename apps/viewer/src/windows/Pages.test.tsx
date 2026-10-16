import { act as actNow, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MOCK_STATE } from "./controls.ts";
import { QuickSettingsPage, SettingsPage } from "./Pages.tsx";

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
});

function inApp() {
  const invoke = vi.fn((cmd: string) => Promise.resolve(cmd === "controls_state" ? MOCK_STATE : undefined));
  window.__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

describe("the Windows flyout", () => {
  test("shows the toggles, the choices and the sessions, and sends a change to the app", async () => {
    const invoke = inApp();
    render(<QuickSettingsPage />);
    await screen.findByRole("button", { name: "On top" });
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(6);
    expect(screen.getByText("PoupAI")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Smooth" }));
    expect(screen.getByRole("radio", { name: "Smooth" }).getAttribute("aria-checked")).toBe("true");
    expect(invoke).toHaveBeenCalledWith("controls_set", { key: "look", value: "smooth" });

    fireEvent.click(screen.getByRole("button", { name: "On top" }));
    expect(invoke).toHaveBeenCalledWith("controls_set", { key: "alwaysOnTop", value: false });

    fireEvent.click(screen.getByText("FlowCTL"));
    expect(invoke).toHaveBeenCalledWith("controls_action", { request: { action: "focus", id: "a" } });
  });

  test("follows the state the app sends", async () => {
    inApp();
    render(<QuickSettingsPage />);
    await screen.findByRole("button", { name: "On top" });
    actNow(() => window.flowctlControls?.update({ ...MOCK_STATE, prefs: { ...MOCK_STATE.prefs, alwaysOnTop: false } }));
    expect(screen.getByRole("button", { name: "On top" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the Windows Settings page", () => {
  test("switches and drop-downs send their changes", async () => {
    const invoke = inApp();
    render(<SettingsPage />);
    const switches = await screen.findAllByRole("switch");
    expect(switches).toHaveLength(5);
    fireEvent.click(switches[0]!);
    expect(invoke).toHaveBeenCalledWith("controls_set", { key: "alwaysOnTop", value: false });
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "Large" } });
    expect(invoke).toHaveBeenCalledWith("controls_set", { key: "size", value: "Large" });
  });
});
