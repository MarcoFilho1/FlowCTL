import { render, screen } from "@testing-library/react";
import { selectReadyTaskIds } from "@flowctl/control-plane";
import { PROTOCOL_VERSION } from "@flowctl/protocol";
import { App } from "../src/App.js";

test("renders the accessible Playground shell and resolves public FlowCTL exports", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "FlowCTL Playground" })).toBeTruthy();
  expect(selectReadyTaskIds).toBeTypeOf("function");
  expect(PROTOCOL_VERSION).toBeTypeOf("string");
});
