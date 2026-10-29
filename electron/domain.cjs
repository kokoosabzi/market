function roundRatio(numerator, denominator) {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (n < 0n || d <= 0n) throw new RangeError('Ratio requires a non-negative numerator and positive denominator');
  return Number((n + d / 2n) / d);
}

function calculateLine({ quantityMilli, unitPriceIrr, discountType = 'none', discountValue = 0, taxRateBp = 0 }) {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) throw new RangeError('Quantity must be a positive integer in thousandths');
  if (!Number.isSafeInteger(unitPriceIrr) || unitPriceIrr < 0) throw new RangeError('Unit price must be a non-negative integer in rials');
  if (!['none', 'fixed', 'percent'].includes(discountType)) throw new RangeError('Discount type is invalid');
  if (!Number.isSafeInteger(discountValue) || discountValue < 0) throw new RangeError('Discount value is invalid');
  if (discountType === 'percent' && discountValue > 100) throw new RangeError('Percent discount must be between 0 and 100');
  if (!Number.isSafeInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000) throw new RangeError('Tax rate must be between 0 and 10000 basis points');
  const gross = roundRatio(BigInt(unitPriceIrr) * BigInt(quantityMilli), 1000);
  const discount = discountType === 'none' ? 0
    : discountType === 'fixed' ? Math.min(gross, discountValue)
      : roundRatio(BigInt(gross) * BigInt(discountValue), 100);
  const tax = roundRatio(BigInt(gross - discount) * BigInt(taxRateBp), 10000);
  return { gross, discount, tax, total: gross - discount + tax };
}

function calculateProfit(items) {
  if (!Array.isArray(items)) throw new TypeError('Profit items must be an array');
  let revenueIrr = 0;
  let costIrr = 0;
  let costStatus = 'known';
  for (const item of items) {
    const quantity = Number(item.quantityMilli);
    const returned = Number(item.returnedQuantityMilli || 0);
    const gross = Number(item.grossIrr);
    const discount = Number(item.discountIrr || 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isSafeInteger(returned) || returned < 0 || returned > quantity ||
        !Number.isSafeInteger(gross) || gross < 0 ||
        !Number.isSafeInteger(discount) || discount < 0 || discount > gross) {
      throw new RangeError('Profit item values are invalid');
    }
    const netQuantity = quantity - returned;
    if (netQuantity === 0) continue;
    revenueIrr += roundRatio(BigInt(gross - discount) * BigInt(netQuantity), BigInt(quantity));
    if (item.unitCostSnapshotIrr === null || item.unitCostSnapshotIrr === undefined) {
      costStatus = 'unknown';
      continue;
    }
    const unitCost = Number(item.unitCostSnapshotIrr);
    if (!Number.isSafeInteger(unitCost) || unitCost < 0) throw new RangeError('Cost snapshot is invalid');
    costIrr += roundRatio(BigInt(unitCost) * BigInt(netQuantity), 1000n);
    if (item.costStatus === 'estimated' && costStatus !== 'unknown') costStatus = 'estimated';
  }
  return {
    revenueIrr,
    costIrr: costStatus === 'unknown' ? null : costIrr,
    profitIrr: costStatus === 'unknown' ? null : revenueIrr - costIrr,
    costStatus
  };
}

module.exports = { roundRatio, calculateLine, calculateProfit };
