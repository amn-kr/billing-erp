import { describe, expect, it } from 'vitest';
import { availableForTransfer, stockAfterAdjustment, stockBeforeAdjustment } from '../src/stock';

/** The stock figures the Adjust stock and Transfer stock windows show while a saved one is edited. */
describe('editing a saved stock adjustment', () => {
  it('leaves out its own quantity for the same item only, exactly (Decimal, 3 places)', () => {
    expect(stockBeforeAdjustment('35', { itemId: 'fan', qty: '10' }, 'fan').toFixed(3)).toBe('25.000');
    expect(stockBeforeAdjustment('22', { itemId: 'fan', qty: '-3' }, 'fan').toFixed(3)).toBe('25.000');
    expect(stockBeforeAdjustment('0.3', { itemId: 'wire', qty: '0.1' }, 'wire').toFixed(3)).toBe('0.200');
    expect(stockBeforeAdjustment('200', { itemId: 'fan', qty: '10' }, 'bulb').toFixed(3)).toBe('200.000');
    expect(stockBeforeAdjustment('7', null, 'fan').toFixed(3)).toBe('7.000');
  });

  it('stock after adds or reduces', () => {
    expect(stockAfterAdjustment('25', 'add', '0.1').toFixed(3)).toBe('25.100');
    expect(stockAfterAdjustment('25', 'reduce', '3').toFixed(3)).toBe('22.000');
    expect(stockAfterAdjustment('1', 'reduce', '3').toFixed(3)).toBe('-2.000');
  });
});

describe('editing a saved stock transfer', () => {
  const saved = { itemId: 'fan', fromId: 'main', toId: 'store', qty: '10' };
  it('the godown it took from gets it back, the godown it brought to loses it, other items and godowns are as they are', () => {
    expect(availableForTransfer('15', saved, 'fan', 'main').toFixed(3)).toBe('25.000');
    expect(availableForTransfer('10', saved, 'fan', 'store').toFixed(3)).toBe('0.000');
    expect(availableForTransfer('200', saved, 'bulb', 'main').toFixed(3)).toBe('200.000');
    expect(availableForTransfer('4', saved, 'fan', 'back room').toFixed(3)).toBe('4.000');
    expect(availableForTransfer('4', null, 'fan', 'main').toFixed(3)).toBe('4.000');
    expect(availableForTransfer('0.2', { ...saved, qty: '0.1' }, 'fan', 'main').toFixed(3)).toBe('0.300');
  });
});
