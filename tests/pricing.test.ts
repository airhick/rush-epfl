import { describe, expect, it } from 'vitest';
import { computeHold, deliveryFee, feeSlices, maxActualItems, settle } from '../shared/pricing';

describe('tarif de livraison', () => {
  it('coûte CHF 0.50 par tranche de CHF 5 commencée', () => {
    expect(deliveryFee(150)).toBe(50);
    expect(deliveryFee(350)).toBe(50);
    expect(deliveryFee(500)).toBe(50);
    expect(deliveryFee(501)).toBe(100);
    expect(deliveryFee(1000)).toBe(100);
    expect(deliveryFee(1250)).toBe(150);
    expect(deliveryFee(2300)).toBe(250);
    expect(feeSlices(1250)).toBe(3);
  });

  it('réserve les articles et la rémunération du rusher, sans marge', () => {
    expect(computeHold(1250)).toEqual({ itemsCents: 1250, feeCents: 150, bonusCents: 0, rewardCents: 150, holdCents: 1400 });
    expect(computeHold(1250, 100)).toMatchObject({ rewardCents: 250, holdCents: 1500 });
  });

  it('paie le ticket et la rémunération au rusher, et rend le reste', () => {
    const hold = computeHold(1110, 50);
    const order = { holdCents: hold.holdCents, rewardCents: hold.rewardCents, actualItemsCents: 1080 };
    expect(settle(order)).toEqual({ courierCents: 1080 + 200, refundCents: 30 });
    expect(maxActualItems(order)).toBe(1110);
  });
});
