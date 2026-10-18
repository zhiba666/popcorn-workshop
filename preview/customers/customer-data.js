// Customer UI preview content from docs/customer-module-design.md, section 8.
// This module is separate from mini-game progress and save data.
import { customers, relationshipLabels, thresholds, rewardMultipliers, baseReward as defaultBaseReward } from '../_generated/customer-content.js';

export { customers, relationshipLabels, thresholds };

// Only completed, distinct preset super orders advance stars. Total services are history only.
// This derives display values for the preview; no game state or rewards are changed.
export function getProgress(superOrders, baseReward = defaultBaseReward) {
  const count = Number.isFinite(Number(superOrders)) ? Math.max(0, Math.floor(Number(superOrders))) : 0;
  const reward = Number.isFinite(Number(baseReward)) ? Math.max(3, Math.floor(Number(baseReward))) : defaultBaseReward;
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

// In-memory demonstration data only; never reads or writes the mini-game save.
export function createDemoState() {
  const baseReward = defaultBaseReward;
  const superOrderCounts = Object.fromEntries(customers.map(customer => [customer.id, 0]));
  Object.assign(superOrderCounts, {
    'rabbit-courier': 14,
    'bear-neighbor': 16,
    'dog-mechanic': 0,
    'fox-traveler': 3,
    'squirrel-tailor': 6,
    'cat-teacher': 1,
    'hedgehog-florist': 0,
  });
  const serviceCounts = { ...superOrderCounts };
  Object.assign(serviceCounts, {
    'rabbit-courier': 38,
    'bear-neighbor': 45,
    'fox-traveler': 12,
    'squirrel-tailor': 18,
    'cat-teacher': 4,
    'hedgehog-florist': 20,
  });
  const paidGifts = Object.fromEntries(customers.map(customer => [customer.id,
    Object.fromEntries(thresholds.flatMap((threshold, index) => superOrderCounts[customer.id] >= threshold
      ? [[index + 1, Math.floor(baseReward * rewardMultipliers[index])]] : [])),
  ]));
  return {
    openedGeneration: 3,
    baseReward,
    serviceCounts,
    superOrderCounts,
    superOrderPreviewCustomerId: 'rabbit-courier',
    visiting: ['rabbit-courier', 'dog-mechanic', 'fox-traveler'],
    unread: ['rabbit-courier', 'cat-teacher'],
    unreadKinds: { 'rabbit-courier': 'daily', 'cat-teacher': 'collected' },
    paidGifts,
  };
}
