import { isDeepStrictEqual } from "node:util";
import type { Observation } from "../contracts/index.js";

/** 当前观测及其对应的局面版本。 */
export interface VersionedState {
  /** 最近一次接受的观测，包含当前对局 ID 和完整可见局面。 */
  readonly observation: Observation;
  /** 当前对局的局面版本，从 1 开始，仅在局面内容变化时递增。 */
  readonly stateVersion: number;
}

/** 一个 SDK 会话的当前状态；观测序号跨对局递增。 */
export class StateStore {
  /** 内部独立持有的状态，首次接受观测前为空，不直接暴露给调用方。 */
  #current: VersionedState | null = null;

  /**
   * 接受新观测时返回 true，包括局面内容未变的情况。
   * 序号重复或倒退时返回 false；非安全整数序号抛出 RangeError。
   */
  update(observation: Observation): boolean {
    if (!Number.isSafeInteger(observation.sequence)) {
      throw new RangeError("Observation.sequence 必须为安全整数。");
    }

    const current = this.#current;
    // 先比较会话序号，再处理换局，避免迟到观测将状态切回旧对局。
    if (current && observation.sequence <= current.observation.sequence) {
      return false;
    }

    const nextObservation = structuredClone(observation);
    let stateVersion = 1;
    if (current && nextObservation.gameId === current.observation.gameId) {
      stateVersion = current.stateVersion;
      // 对象属性的书写顺序不影响局面；数组顺序保留并参与比较。
      if (
        !isDeepStrictEqual(
          current.observation.snapshot,
          nextObservation.snapshot,
        )
      ) {
        stateVersion += 1;
      }
    }

    this.#current = { observation: nextObservation, stateVersion };
    return true;
  }

  /** 返回独立的状态副本；尚未接受任何观测时返回 null。 */
  getState(): VersionedState | null {
    return structuredClone(this.#current);
  }
}
