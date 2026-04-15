import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Capture the event listener so we can simulate NFC events
let nfcEventHandler: ((event: { payload: string }) => Promise<void>) | null = null;
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_eventName: string, handler: (event: { payload: string }) => Promise<void>) => {
    nfcEventHandler = handler;
    return mockUnlisten;
  }),
}));

const mockGetLearnerByNfc = vi.fn();
const mockCheckLearnerIn = vi.fn();

vi.mock("../app/utils/utils", () => ({
  getLearnerByNfc: (...args: unknown[]) => mockGetLearnerByNfc(...args),
  checkLearnerIn: (...args: unknown[]) => mockCheckLearnerIn(...args),
}));

// Must import after mocks are set up
import { useNfcLearner } from "@/app/hooks/useNfcLearner";

const fakeLearner = {
  id: "learner1",
  name: "Test Student",
  NFC_ID: "ABCD1234",
};

beforeEach(() => {
  vi.clearAllMocks();
  nfcEventHandler = null;
  mockGetLearnerByNfc.mockResolvedValue(fakeLearner);
  mockCheckLearnerIn.mockResolvedValue(undefined);
});

describe("useNfcLearner", () => {
  it("registers a Tauri event listener on mount", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    renderHook(() => useNfcLearner());

    expect(listen).toHaveBeenCalledWith("nfc-scanned", expect.any(Function));
  });

  it("unregisters listener on unmount", async () => {
    const { unmount } = renderHook(() => useNfcLearner());
    // Give the async listener setup time to complete
    await act(async () => {});

    unmount();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("processes a scan and returns learner data", async () => {
    const { result } = renderHook(() => useNfcLearner());
    await act(async () => {}); // Wait for listener setup

    await act(async () => {
      await nfcEventHandler!({ payload: "ABCD1234" });
    });

    expect(result.current.uid).toBe("ABCD1234");
    expect(result.current.learner).toEqual(fakeLearner);
    expect(result.current.exists).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("calls checkLearnerIn when learner is found", async () => {
    renderHook(() => useNfcLearner());
    await act(async () => {});

    await act(async () => {
      await nfcEventHandler!({ payload: "ABCD1234" });
    });

    expect(mockCheckLearnerIn).toHaveBeenCalledWith("ABCD1234", {
      testTime: undefined,
      testDate: undefined,
    });
  });

  it("does not call checkLearnerIn for unknown UID", async () => {
    mockGetLearnerByNfc.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useNfcLearner());
    await act(async () => {});

    await act(async () => {
      await nfcEventHandler!({ payload: "UNKNOWN" });
    });

    expect(result.current.exists).toBe(false);
    expect(result.current.learner).toBeNull();
    expect(mockCheckLearnerIn).not.toHaveBeenCalled();
  });

  it("blocks concurrent scans with processing lock", async () => {
    // Make the first scan take a while
    let resolveFirst: () => void;
    const firstScanPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    mockGetLearnerByNfc.mockImplementationOnce(() => firstScanPromise.then(() => fakeLearner));

    renderHook(() => useNfcLearner());
    await act(async () => {});

    // Start first scan (will hang on getLearnerByNfc)
    const firstScan = act(async () => {
      await nfcEventHandler!({ payload: "FIRST" });
    });

    // Try second scan while first is processing
    await act(async () => {
      await nfcEventHandler!({ payload: "SECOND" });
    });

    // Second scan should have been skipped — getLearnerByNfc called only once
    expect(mockGetLearnerByNfc).toHaveBeenCalledTimes(1);

    // Complete first scan
    resolveFirst!();
    await firstScan;
  });

  it("allows next scan after previous completes", async () => {
    renderHook(() => useNfcLearner());
    await act(async () => {});

    // First scan
    await act(async () => {
      await nfcEventHandler!({ payload: "FIRST" });
    });

    // Second scan should work now
    await act(async () => {
      await nfcEventHandler!({ payload: "SECOND" });
    });

    expect(mockGetLearnerByNfc).toHaveBeenCalledTimes(2);
    expect(mockGetLearnerByNfc).toHaveBeenLastCalledWith("SECOND");
  });

  it("releases lock even when scan errors", async () => {
    mockGetLearnerByNfc.mockRejectedValueOnce(new Error("DB error"));

    renderHook(() => useNfcLearner());
    await act(async () => {});

    // First scan errors
    await act(async () => {
      await nfcEventHandler!({ payload: "ERROR_SCAN" });
    });

    // Second scan should still work (lock was released in finally)
    mockGetLearnerByNfc.mockResolvedValueOnce(fakeLearner);
    await act(async () => {
      await nfcEventHandler!({ payload: "NEXT_SCAN" });
    });

    expect(mockGetLearnerByNfc).toHaveBeenCalledTimes(2);
  });
});
