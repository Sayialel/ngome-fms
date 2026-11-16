import { describe, expect, it } from 'vitest';
import { buildPlan, identify, matchByPeople, matchClient, parseCsv, parseDate, planIssues } from './notion-import';

const clients = [
  { id: 'pf', code: 'CA-0001', name: 'Pathfinders' },
  { id: 'mg', code: 'CA-0003', name: 'Mumbi Gacau' },
  { id: 'lo', code: 'CA-0008', name: 'Lilian Ogallo' },
  { id: 'gl', code: 'CA-0002', name: 'Grace Lutien' },
  { id: 'gm', code: 'CA-0013', name: 'Grace Mathenge' },
];
const accounts = [{ id: 'A-EXP', code: 'expense' }, { id: 'A-SUB', code: 'subscriptions' }];

describe('reading the Notion export', () => {
  it('parses CSV with quoted commas, quotes and line breaks', () => {
    const rows = parseCsv('﻿"Name ",Amount\n"Jasiri, taught on 1/10\n8/10","1,500"\n"He said ""hi""",2\n');
    expect(rows).toEqual([{ Name: 'Jasiri, taught on 1/10\n8/10', Amount: '1,500' }, { Name: 'He said "hi"', Amount: '2' }]);
  });

  it('reads Notion dates', () => {
    expect(parseDate('October 11, 2026')).toBe('2026-10-11');
    expect(parseDate('25 Sept 26')).toBe('2026-09-25');
    expect(parseDate('June 14, 2026,November 30, 2026')).toBe('2026-06-14');
    expect(parseDate('')).toBeNull();
  });

  it('matches clients by surname, tolerating one letter', () => {
    expect(matchClient('Mumbi Gachau', clients)).toBe('mg');
    expect(matchClient('Lillian Ogallo', clients)).toBe('lo');
    expect(matchClient('Pathfinders - Client Acc', clients)).toBe('pf');
    expect(matchClient('Grace Lutien', clients)).toBe('gl');
    expect(matchClient('Somebody Else', clients)).toBeNull();
  });

  it('finds a client from the people mentioned in a label', () => {
    const withPeople = [
      { id: 'gl', code: 'CA-0002', name: 'Grace Lutien', people: ['Grace Lutien', 'Eleana Lutien'] },
      { id: 'gm', code: 'CA-0013', name: 'Grace Mathenge', people: ['Grace Mathenge', 'Ryan Mwangi'] },
      { id: 'wm', code: 'CA-0009', name: 'Wanjiru Mbugua', people: ['Wanjiru Mbugua', 'Richard Waugh', 'Matthew Waugh'] },
      { id: 'no', code: 'CA-0014', name: 'Nzisa Ochola', people: ['Zia Ochola'] },
    ];
    expect(matchByPeople('Funds from Mama Zia (Physical)', withPeople)).toBe('no');
    expect(matchByPeople('Funds from Grace Wanjiru (Mama Ryan)', withPeople)).toBe('gm');
    expect(matchByPeople('Funds from Waugh 25th Sept', withPeople)).toBe('wm');
    expect(matchByPeople('Funds from Grace', withPeople)).toBeNull(); // two Graces
    expect(matchByPeople('Funds from Debate Classes', withPeople)).toBeNull();
  });

  const tracker = `"Particulars of Bill ",Client Account ,"Date of Billing ",Date of Receiving,"Invoice Ref ",Note,Notes,"Point of Payment ","Receipt Gen. ","Remitted ",Remitted On?,"Revenue "
"🔵 MW Dev I taught on 04/06/2026, 11/06/2026",Pathfinders - Client Acc (https://app.notion.com/p/x),"July 3, 2026","June 26, 2026",PF/001/2026,Note here,,Lillian Ogallo 🔴 🟢,Yes,No,,"5,000"
🔵 MW Dev I taught on 18/06/2026,,"July 10, 2026",,PF/002/2026,,,Lillian Ogallo 🔴,No,No,,"2,500"
🔴 MW FII taught on Th 02.04.26,,"April 2, 2026","April 20, 2026",,,,Lillian Ogallo 🔴,Yes,Yes,"April 24, 2026","2,500"
🔴 JA FII taught on _____,,,,,,,Nobody Known,Yes,Yes,,"2,000"`;
  const online = `Funds raised being remitted,Class Type,"No. ",RE,PAFD,JMS,EL,EW,Received Amount,Received On,Received On?,Remitted,Remitted On?,Invoice/ Receipt Ref,"Notes "
Pathfinders June,ONL,5,500,4500,2000,1250,1250,"5,000","June 26, 2026",,Yes,"July 3, 2026",PF/001/2026,
Mama Kimberly Physicals 2 Nov,PHY,,,,1670,835,835,"3,340","November 2, 2026",,No,,,`;
  const physical = `Funds raised being remitted,Class Type,"No. ",JMS,EL,EW,Received Amount,Received On,Received On?,Remitted,Remitted On?,Invoice/ Receipt Ref,Total Phy
Pathfinders June,,5,0,0,0,"5,000",,,Yes,,PF/001/2026,0
Mama Ryan Physicals 3 Oct,PHY,48,675,337.5,337.5,"1,350","October 3, 2026",,Yes,,,1350`;
  const expenses = `"Expense ","Spent on ","Spent ",Notes,"Source ",Nature of Expense,Recurrence,Accounted Pre-Disbursement
Claude subscription,"September 14, 2026","3,109.56",,JV,Recurring,Monthly,No
Buying of printing paper,"September 6, 2026",810,Paper,Ngome,One-off,,Yes`;
  const runs = `"Date of Balancing ",PB 1,RE Totals,Total C,ANR 1,AELD 1,DP 1,CB 1,Date
25 Sept 26,"18,745.00",3560,0.00,"35,600","13,305.00","27,816.00","9,000","September 25, 2026"
25 Sept 2026,"18,745.00",3560,0.00,"35,600","13,305.00","27,816.00","9,000",`;

  const plan = buildPlan(
    [{ name: 'tracker.csv', text: tracker }, { name: 'online.csv', text: online }, { name: 'physical.csv', text: physical }, { name: 'expenses.csv', text: expenses }, { name: 'runs.csv', text: runs }, { name: 'tracker copy.csv', text: tracker }],
    clients, accounts,
  );

  it('recognises each file', () => {
    expect(plan.files.map((f) => f.kind)).toEqual(['tracker', 'online', 'physical', 'expenses', 'runs1', 'tracker']);
    expect(identify([{ Something: 'x' }])).toBe('other');
  });

  it('maps invoices to clients: the named account, then the ref prefix, then the payer', () => {
    expect(plan.invoices).toHaveLength(4); // the second copy of the file adds nothing
    expect(plan.invoices.map((i) => i.client_id)).toEqual(['pf', 'pf', 'lo', null]);
    expect(plan.invoices[0]).toMatchObject({ particulars: 'MW Dev I taught on 04/06/2026, 11/06/2026', invoice_ref: 'PF/001/2026', billing_date: '2026-07-03', received_on: '2026-06-26', amount_cents: 500000, receipt_generated: true, remitted: false, payer: 'Lillian Ogallo', note: 'Note here' });
  });

  it('keeps online entries once and only the real physical rows', () => {
    expect(plan.entries.map((e) => [e.label, e.stream, e.amount_cents / 100, e.client_id])).toEqual([
      ['Pathfinders June', 'online', 5000, 'pf'],
      ['Mama Kimberly Physicals 2 Nov', 'physical', 3340, null],
      ['Mama Ryan Physicals 3 Oct', 'physical', 1350, null],
    ]);
    expect(plan.entries[0]).toMatchObject({ entry_no: 5, re_cents: 50000, pafd_cents: 450000, jms_cents: 200000, remitted_on: '2026-07-03' });
    expect(plan.entries[2].el_cents).toBe(33750);
  });

  it('maps expenses to the paying account and runs to one per date', () => {
    expect(plan.expenses.map((e) => [e.item, e.account_id, e.amount_cents, e.spent_on])).toEqual([['Claude subscription', 'A-SUB', 310956, '2026-09-14'], ['Buying of printing paper', 'A-EXP', 81000, '2026-09-06']]);
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]).toMatchObject({ run_date: '2026-09-25', is_legacy: true, result: { anr: 3560000, pafd: 2781600, closingBalance: 900000 } });
  });

  it('lists what needs a look', () => {
    expect(planIssues(plan).map((i) => i.detail)).toEqual(['no invoice ref', 'no client matched, no invoice ref, no billing date, session dates left blank']);
  });
});
