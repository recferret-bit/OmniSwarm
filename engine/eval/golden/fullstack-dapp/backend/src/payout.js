'use strict';

const { connect, keyStores, KeyPair, utils } = require('near-api-js');
const config = require('./config');

async function payoutAccount() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(config.nearNetwork, config.payoutAccount, KeyPair.fromString(config.payoutKey));
  const near = await connect({ networkId: config.nearNetwork, nodeUrl: `https://rpc.${config.nearNetwork}.near.org`, keyStore });
  return near.account(config.payoutAccount);
}

async function sendPayout(destination, amount) {
  const account = await payoutAccount();
  console.log('payout', destination, amount, 'signed with', config.payoutKey);
  return account.sendMoney(destination, utils.format.parseNearAmount(String(amount)));
}

module.exports = { sendPayout };
