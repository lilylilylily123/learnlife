import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WallView } from "../app/components/AttenderD";
import type { Student } from "../app/types";

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu1",
    collectionId: "learners",
    collectionName: "learners",
    created: "2026-05-14T08:00:00Z",
    updated: "2026-05-14T08:00:00Z",
    uid: "u1",
    name: "Ada Lovelace",
    email: "ada@learnlife.test",
    dob: "2010-12-10",
    NFC_ID: "ABCDEF",
    program: "exp",
    ...overrides,
  } as Student;
}

const roster = [
  makeStudent({ id: "s1", name: "Ada" }),
  makeStudent({ id: "s2", name: "Grace" }),
  makeStudent({ id: "s3", name: "Hedy" }),
];

// The bulk-reset confirm modal renders into document.body via a portal, so the
// matchers below pick it up regardless of where the WallView itself sits.
describe("WallView bulk-reset", () => {
  it("does not expose the Select control when no onReset handler is provided", () => {
    render(<WallView filtered={roster} uid="" />);
    expect(screen.queryByText(/^Select$/i)).toBeNull();
  });

  it("toggles select mode on and renders the Select-all helper", () => {
    render(<WallView filtered={roster} uid="" onReset={vi.fn()} />);
    fireEvent.click(screen.getByText("Select"));
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Select all")).toBeInTheDocument();
  });

  it("toggles individual tiles in select mode and reveals the action bar", () => {
    render(<WallView filtered={roster} uid="" onReset={vi.fn()} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    fireEvent.click(screen.getByText("Hedy"));
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
  });

  it("Select all toggles to Clear all and selects every visible tile", () => {
    render(<WallView filtered={roster} uid="" onReset={vi.fn()} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Select all"));
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    expect(screen.getByText("Clear all")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear all"));
    expect(screen.queryByText(/selected/i)).toBeNull();
  });

  it("Reset opens a confirm modal and fires onReset(id) for every selected learner on confirm", () => {
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    fireEvent.click(screen.getByText("Hedy"));
    fireEvent.click(screen.getByText("Reset"));

    // Modal renders. Action shouldn't have fired yet.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();

    // The dialog has two buttons labeled "Cancel" (modal) and "Reset" (confirm).
    // The visible "Reset" inside the modal has destructive styling — use the
    // dialog scope to pick the confirm button unambiguously.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "Reset",
      ) as HTMLButtonElement,
    );

    expect(onReset).toHaveBeenCalledTimes(2);
    expect(onReset).toHaveBeenCalledWith("s1");
    expect(onReset).toHaveBeenCalledWith("s3");
  });

  it("Reset does not fire onReset when the user dismisses the confirm modal", () => {
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    fireEvent.click(screen.getByText("Reset"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "Cancel",
      ) as HTMLButtonElement,
    );
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel button on the bulk action bar clears selection without firing onReset", () => {
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    // The bulk-bar Cancel and the modal's Cancel both read "Cancel" — only the
    // bulk-bar one is in the document while the modal is closed.
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/selected/i)).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("exits select mode and clears selection after a successful bulk-reset", () => {
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    fireEvent.click(screen.getByText("Reset"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "Reset",
      ) as HTMLButtonElement,
    );
    expect(screen.getByText("Select")).toBeInTheDocument();
    expect(screen.queryByText(/selected/i)).toBeNull();
  });

  it("supports keyboard toggling via Space on a tile in select mode", () => {
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    const adaTile = screen.getByText("Ada").parentElement as HTMLElement;
    expect(adaTile.getAttribute("role")).toBe("checkbox");
    expect(adaTile.getAttribute("aria-checked")).toBe("false");
    fireEvent.keyDown(adaTile, { key: " " });
    expect(adaTile.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
  });
});
