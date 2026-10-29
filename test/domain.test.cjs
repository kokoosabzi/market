const test = require('node:test');
const assert = require('node:assert/strict');
const { roundRatio, calculateLine, calculateProfit } = require('../electron/domain.cjs');

test('integer ratio rounds half up without floating-point money arithmetic', () => {
  assert.equal(roundRatio(5n, 2n), 3);
  assert.equal(roundRatio(4n, 3n), 1);
  assert.equal(roundRatio(7n, 3n), 2);
  assert.throws(() => roundRatio(-1n, 2n), RangeError);
  assert.throws(() => roundRatio(1n, 0n), RangeError);
});
test('line totals apply discount before tax and preserve integer rials', () => {
  const line = calculateLine({ quantityMilli: 2000, unitPriceIrr: 1000000, discountType: 'percent', discountValue: 10, taxRateBp: 0 });
  assert.deepEqual(line, { gross: 2000000, discount: 200000, tax: 0, total: 1800000 });
  const taxed = calculateLine({ quantityMilli: 1000, unitPriceIrr: 1001, discountType: 'none', discountValue: 0, taxRateBp: 500 });
  assert.deepEqual(taxed, { gross: 1001, discount: 0, tax: 50, total: 1051 });
});
test('fixed discounts are capped at gross and invalid percentages are rejected', () => {
  assert.deepEqual(calculateLine({ quantityMilli: 1000, unitPriceIrr: 900, discountType: 'fixed', discountValue: 1500 }), { gross: 900, discount: 900, tax: 0, total: 0 });
  assert.throws(() => calculateLine({ quantityMilli: 1000, unitPriceIrr: 1000, discountType: 'percent', discountValue: 101 }), /between 0 and 100/);
  assert.throws(() => calculateLine({ quantityMilli: 1000, unitPriceIrr: 1.5 }), /integer in rials/);
  assert.throws(() => calculateLine({ quantityMilli: 0, unitPriceIrr: 1 }), /positive integer/);
});


test('gross profit excludes tax, nets finalized returned quantity, and uses sale cost snapshots', () => {
  const result = calculateProfit([
    { quantityMilli: 3000, returnedQuantityMilli: 1000, grossIrr: 33000, discountIrr: 3000, unitCostSnapshotIrr: 10000, costStatus: 'known' }
  ]);
  assert.deepEqual(result, { revenueIrr: 20000, costIrr: 20000, profitIrr: 0, costStatus: 'known' });
});
test('gross profit marks unknown costs instead of inventing a profit', () => {
  const result = calculateProfit([
    { quantityMilli: 1000, returnedQuantityMilli: 0, grossIrr: 12000, discountIrr: 0, unitCostSnapshotIrr: null, costStatus: 'unknown' }
  ]);
  assert.deepEqual(result, { revenueIrr: 12000, costIrr: null, profitIrr: null, costStatus: 'unknown' });
});
test('gross profit labels estimated costs and handles fully returned lines', () => {
  const estimated = calculateProfit([
    { quantityMilli: 2000, returnedQuantityMilli: 0, grossIrr: 10000, discountIrr: 0, unitCostSnapshotIrr: 3000, costStatus: 'estimated' }
  ]);
  assert.deepEqual(estimated, { revenueIrr: 10000, costIrr: 6000, profitIrr: 4000, costStatus: 'estimated' });
  const returned = calculateProfit([
    { quantityMilli: 1000, returnedQuantityMilli: 1000, grossIrr: 9000, discountIrr: 0, unitCostSnapshotIrr: null, costStatus: 'unknown' }
  ]);
  assert.deepEqual(returned, { revenueIrr: 0, costIrr: 0, profitIrr: 0, costStatus: 'known' });
});
