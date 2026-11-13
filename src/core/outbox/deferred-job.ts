// A scheduler deferral is not an action failure and does not consume retry budget.
export class DeferredOutboxJob extends Error {
  constructor(readonly availableAt: Date) {
    super('Delivery deferred');
    if (!Number.isFinite(availableAt.getTime()) || availableAt.getTime() <= Date.now()) throw new Error('Deferral must be in the future');
  }
}
