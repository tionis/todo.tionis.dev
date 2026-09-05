import { Worker } from "node:worker_threads";

const PROCESSING_TIMEOUT_MS = 10_000;
const MAX_QUEUED_OPERATIONS = 100;

export class DocumentProcessor {
  constructor({ idleTimeoutMs = 30_000 } = {}) {
    this.worker = null;
    this.idleTimeoutMs = idleTimeoutMs;
    this.idleTimer = null;
    this.queue = Promise.resolve();
    this.queuedOperations = 0;
  }

  process(action, currentBytes, incomingBytes, resetAt) {
    if (this.queuedOperations >= MAX_QUEUED_OPERATIONS) {
      return Promise.reject(Object.assign(new Error("Document processor is busy"), { status: 503 }));
    }
    clearTimeout(this.idleTimer);
    this.queuedOperations += 1;
    const operation = this.queue.catch(() => {}).then(
      () => this.execute(action, currentBytes, incomingBytes, resetAt)
    );
    this.queue = operation.then(() => {}, () => {}).finally(() => {
      this.queuedOperations -= 1;
      if (this.queuedOperations === 0 && this.worker) {
        const worker = this.worker;
        this.idleTimer = setTimeout(() => {
          if (this.worker !== worker || this.queuedOperations !== 0) return;
          this.worker = null;
          // WASM linear memory cannot shrink after a large document. Retiring
          // an idle worker releases its high-water allocation without a restart.
          void worker.terminate();
        }, this.idleTimeoutMs);
        this.idleTimer.unref();
      }
    });
    return operation;
  }

  ensureWorker() {
    if (!this.worker) {
      const worker = new Worker(new URL("./document-worker.mjs", import.meta.url), {
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      });
      worker.on("error", () => { if (this.worker === worker) this.worker = null; });
      worker.on("exit", () => { if (this.worker === worker) this.worker = null; });
      worker.unref();
      this.worker = worker;
    }
    return this.worker;
  }

  execute(action, currentBytes, incomingBytes, resetAt) {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onFailure);
        worker.off("exit", onExit);
      };
      const onMessage = (message) => {
        cleanup();
        if (message.error) reject(new Error(message.error));
        else resolve(message.bytes);
      };
      const onFailure = (error) => {
        cleanup();
        this.worker = null;
        reject(error);
      };
      const onExit = (code) => {
        cleanup();
        this.worker = null;
        reject(new Error(`Document processor stopped (${code})`));
      };
      const timer = setTimeout(() => {
        cleanup();
        this.worker = null;
        void worker.terminate();
        reject(new Error("Document processing timed out"));
      }, PROCESSING_TIMEOUT_MS);
      worker.on("message", onMessage);
      worker.on("error", onFailure);
      worker.on("exit", onExit);
      worker.postMessage({ action, currentBytes, incomingBytes, resetAt });
    });
  }
}
