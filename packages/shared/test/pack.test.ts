import { describe, expect, it } from 'vitest';
import { allocText, autoPurchasePrice, batchPrintLine, costOfGoods, looseCost, loosePrice, money, packQtyText, stockByBatch, stockByPurchaseRate, stockQtyOf, type LedgerMove } from '../src';

const strip = { packUnit: 'STRIP', packSize: '10.000' };

describe('pack and loose: conversion', () => {
  it('a line moves its quantity × its pack size; no pack size is its own quantity', () => {
    expect(stockQtyOf('2', '10').toFixed(3)).toBe('20.000');
    expect(stockQtyOf('1.5', '15').toFixed(3)).toBe('22.500');
    expect(stockQtyOf('3', null).toFixed(3)).toBe('3.000');
    expect(stockQtyOf('0.5').toFixed(3)).toBe('0.500');
    expect(stockQtyOf('0.333', '10').toFixed(3)).toBe('3.330');
  });

  it('the loose price is the pack’s ÷ its size, to the paisa', () => {
    expect(loosePrice('100', '10').toFixed(2)).toBe('10.00');
    expect(loosePrice('100', '15').toFixed(2)).toBe('6.67');
    expect(loosePrice('100', '3').toFixed(2)).toBe('33.33');
    expect(loosePrice('100', null).toFixed(2)).toBe('100.00');
  });

  it('the exact cost keeps 6 decimals, so a strip of 15 is still worth what it cost', () => {
    expect(looseCost('100', '15').toFixed(6)).toBe('6.666667');
    expect(looseCost('100', '15').times(15).toDecimalPlaces(2).toFixed(2)).toBe('100.00');
    expect(loosePrice('100', '15').times(15).toFixed(2)).toBe('100.05');
  });

  it('stock reads in both units', () => {
    expect(packQtyText('53', 'TAB', strip)).toBe('5 STRIP 3 TAB');
    expect(packQtyText('20', 'TAB', strip)).toBe('2 STRIP');
    expect(packQtyText('3', 'TAB', strip)).toBe('3 TAB');
    expect(packQtyText('0', 'TAB', strip)).toBe('0 TAB');
    expect(packQtyText('10.5', 'TAB', strip)).toBe('1 STRIP 0.5 TAB');
    expect(packQtyText('-13', 'TAB', strip)).toBe('−1 STRIP 3 TAB');
    expect(packQtyText('53', 'PCS', null)).toBe('53 PCS');
  });

  it('batch lines name the loose unit only when asked', () => {
    const list = [{ batchId: 'a', no: 'A123', expiry: '2040-03-31', qty: '20.000', mrp: '120.00' }];
    expect(allocText([{ batchId: 'a', qty: '20.000' }], [{ id: 'a', no: 'A123' }], 'TAB')).toBe('A123 × 20 TAB');
    expect(allocText([{ batchId: 'a', qty: '20.000' }], [{ id: 'a', no: 'A123' }])).toBe('A123 × 20');
    expect(batchPrintLine(list, true, 'TAB')).toBe('Batch A123 × 20 TAB (Exp 03/2040, MRP 120.00)');
    expect(batchPrintLine(list, true)).toBe('Batch A123 × 20 (Exp 03/2040, MRP 120.00)');
  });
});

describe('pack and loose: the lots', () => {
  const cost = looseCost('100', '15').toString();
  const bought: LedgerMove[] = [{ date: '2026-10-01', qty: '45', rate: cost, kind: 'purchase', sourceType: 'purchase_document', sourceId: 'b1' }];

  it('3 strips of 15 at ₹100: 45 tablets worth ₹300, ₹100 per strip', () => {
    const t = stockByPurchaseRate(bought, 0, 15);
    expect(t).toMatchObject({ totalQty: '45.000', value: '300.00', avgRate: '100.00', lastRate: '100.00' });
    expect(t.layers[0]).toMatchObject({ rate: '100.00', qty: '45.000' });
    expect(autoPurchasePrice(bought, 15)).toBe('100.00');
  });

  it('selling loose takes the exact cost; what is left and what was sold add up', () => {
    const moves: LedgerMove[] = [...bought, { date: '2026-10-02', qty: '-7', rate: '0', kind: 'sale', sourceType: 'sales_document', sourceId: 's1' }];
    const t = stockByPurchaseRate(moves, 0, 15);
    const c = costOfGoods(moves).get('s1')!;
    expect(t.totalQty).toBe('38.000');
    expect(money(t.value).plus(c.cost).toFixed(2)).toBe('300.00');
    expect(c.cost).toBe('46.67');
  });

  it('by batch, rates are per pack and the values add up to the stock value', () => {
    const moves: LedgerMove[] = [...bought, { date: '2026-10-01', qty: '10', rate: looseCost('70', '15').toString(), kind: 'purchase', sourceType: 'purchase_document', sourceId: 'b2', batchId: 'x' }];
    const { rows } = stockByBatch(moves, 0, 15);
    expect(rows.find((r) => r.batchId === 'x')).toMatchObject({ qty: '10.000', rate: '70.00' });
    expect(rows.find((r) => r.batchId === null)).toMatchObject({ qty: '45.000', rate: '100.00', value: '300.00' });
  });

  it('no pack size: the very same result as before', () => {
    expect(stockByPurchaseRate(bought, 0)).toEqual(stockByPurchaseRate(bought, 0, 1));
    expect(autoPurchasePrice(bought)).toBe(money(cost).toFixed(2));
  });
});
