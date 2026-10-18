'use strict';

// Authored customer content is generated for both the mini-game and browser preview.
// Prototype relationship economics retain the preview baseline until stage incomes are authored.
const {
  customers: CUSTOMERS, relationshipLabels, thresholds, rewardMultipliers,
  baseReward: CUSTOMER_BASE_REWARD,
} = require('../../generated/customer-content');

function getProgress(superOrdersCompleted, baseReward = CUSTOMER_BASE_REWARD) {
  const count = Number.isFinite(Number(superOrdersCompleted)) ? Math.max(0, Math.floor(Number(superOrdersCompleted))) : 0;
  const reward = Number.isFinite(Number(baseReward)) ? Math.max(3, Math.floor(Number(baseReward))) : CUSTOMER_BASE_REWARD;
  const stars = thresholds.filter(threshold => count >= threshold).length;
  if (stars === 5) {
    return { stars, label: relationshipLabels[4], current: 0, goal: 0, remaining: 0, nextStar: null, nextGift: 0 };
  }
  const previous = stars ? thresholds[stars - 1] : 0;
  return {
    stars,
    label: stars ? relationshipLabels[stars - 1] : '零星',
    current: count - previous,
    goal: thresholds[stars] - previous,
    remaining: thresholds[stars] - count,
    nextStar: stars + 1,
    nextGift: Math.floor(reward * rewardMultipliers[stars]),
  };
}

const productIds = { '原味': 'original', '焦糖': 'caramel', '爆米花球': 'popcorn-ball', '脆棒': 'crisp-stick', '薄脆': 'wafer', '夹心脆方': 'sandwich-square' };
// Super-order content is intentionally unconfigured until it is authored.
for (const customer of CUSTOMERS) {
  customer.primaryProduct = productIds[customer.primary];
  customer.secondaryProduct = productIds[customer.secondary] || null;
  customer.superOrders = Object.freeze([]);
  for (const entry of [...customer.stages, ...customer.daily]) Object.freeze(entry);
  Object.freeze(customer.stages); Object.freeze(customer.daily); Object.freeze(customer);
}
Object.freeze(CUSTOMERS); Object.freeze(relationshipLabels); Object.freeze(thresholds);
function getCustomer(id) { return CUSTOMERS.find(customer => customer.id === id) || null; }
function getSuperOrder() { return null; }
module.exports = { CUSTOMERS, getCustomer, getSuperOrder, getProgress, relationshipLabels, thresholds, CUSTOMER_BASE_REWARD };
