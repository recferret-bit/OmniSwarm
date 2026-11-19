export function account(id, contractId, gas, deposit) {
  const keyStore = new InMemoryKeyStore();
  const scope = { contractId, methodNames: ['tip'] };
  const action = actionCreators.functionCall('tip', { accountId: id }, gas, deposit);
  return { accountId: id, keyStore, scope, action };
}
