import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("WallView bulk-reset", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

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

  it("Reset fires onReset(id) for every selected learner after confirmation", () => {
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    fireEvent.click(screen.getByText("Hedy"));
    fireEvent.click(screen.getByText("Reset"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(2);
    expect(onReset).toHaveBeenCalledWith("s1");
    expect(onReset).toHaveBeenCalledWith("s3");
  });

  it("Reset does not fire onReset when the user cancels the confirmation", () => {
    confirmSpy.mockReturnValue(false);
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    fireEvent.click(screen.getByText("Reset"));
    expect(onReset).not.toHaveBeenCalled();
  });

  it("Cancel button clears selection without firing onReset", () => {
    const onReset = vi.fn();
    render(<WallView filtered={roster} uid="" onReset={onReset} />);
    fireEvent.click(screen.getByText("Select"));
    fireEvent.click(screen.getByText("Ada"));
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
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
