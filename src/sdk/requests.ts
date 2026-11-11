import type {
  DecisionRequest,
  GameState,
  InvalidationReason,
} from "../contracts/index.js";

interface RequestRecord {
  request: DecisionRequest;
  status: "pending" | "executing" | "completed" | "invalidated";
}

export interface InvalidatedRequest {
  request: DecisionRequest;
  reason: InvalidationReason;
}

export class RequestManager {
  private readonly records = new Map<string, RequestRecord>();
  private readonly closedWindows = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  private windowKey(gameId: string, windowId: string): string {
    return JSON.stringify([gameId, windowId]);
  }

  pending(): DecisionRequest[] {
    return [...this.records.values()]
      .filter((r) => r.status === "pending")
      .map((r) => structuredClone(r.request));
  }

  getPending(id: string): DecisionRequest | undefined {
    const record = this.records.get(id);
    return record?.status === "pending"
      ? structuredClone(record.request)
      : undefined;
  }

  reconcile(state: GameState): {
    invalidated: InvalidatedRequest[];
    created?: DecisionRequest;
  } {
    const invalidated: InvalidatedRequest[] = [];
    for (const request of this.pending()) {
      const expired = this.now() >= request.deadlineAt;
      if (
        expired ||
        request.gameId !== state.gameId ||
        request.stateVersion !== state.version
      ) {
        const reason = expired ? "timeout" : "state_changed";
        const item = this.invalidate(
          request.id,
          reason,
          expired ||
            request.windowId !== state.window?.id ||
            request.gameId !== state.gameId,
        );
        if (item) invalidated.push(item);
      }
    }

    const window = state.window;
    if (
      !window ||
      state.phase === "finished" ||
      window.playerId !== state.playerId ||
      window.deadlineAt <= this.now() ||
      window.legalActions.length === 0
    ) {
      return { invalidated };
    }
    const key = this.windowKey(state.gameId, window.id);
    const id = JSON.stringify([state.gameId, window.id, state.version]);
    if (this.closedWindows.has(key) || this.records.has(id))
      return { invalidated };
    const request: DecisionRequest = {
      id,
      gameId: state.gameId,
      windowId: window.id,
      playerId: state.playerId,
      kind: window.kind,
      stateVersion: state.version,
      createdAt: this.now(),
      deadlineAt: window.deadlineAt,
      legalActions: structuredClone(window.legalActions),
      state: structuredClone(state),
    };
    this.records.set(id, { request, status: "pending" });
    return { invalidated, created: structuredClone(request) };
  }

  invalidate(
    id: string,
    reason: InvalidationReason,
    closeWindow = true,
  ): InvalidatedRequest | undefined {
    const record = this.records.get(id);
    if (!record || record.status !== "pending") return undefined;
    record.status = "invalidated";
    if (closeWindow)
      this.closedWindows.add(
        this.windowKey(record.request.gameId, record.request.windowId),
      );
    return { request: structuredClone(record.request), reason };
  }

  claim(id: string): boolean {
    const record = this.records.get(id);
    if (
      !record ||
      record.status !== "pending" ||
      this.now() >= record.request.deadlineAt
    )
      return false;
    record.status = "executing";
    this.closedWindows.add(
      this.windowKey(record.request.gameId, record.request.windowId),
    );
    return true;
  }

  complete(id: string): void {
    const record = this.records.get(id);
    if (record?.status === "executing") record.status = "completed";
  }
}
