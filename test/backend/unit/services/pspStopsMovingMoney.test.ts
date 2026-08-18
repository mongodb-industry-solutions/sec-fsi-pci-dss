// v37 P5.3 and N1: the PSP stops moving money it does not hold, and keeps the decision that is its own.
//
// These are the two defects the whole iteration opened with, expressed as gates:
//   · "P2P invents money": the PSP credited the recipient itself. It cannot. The bank that holds the debtor
//     account debits it, and the creditor is credited by whoever holds THAT account.
//   · N1: `settled` is the bank's fact and `completed` is the PSP's decision. A notification handler records
//     the fact; only the PSP's own process assigns its terminal state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

// Comments are stripped: this is about what the code does, and the explanations are what keep the rules alive.
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('v37 P5.3: the PSP does not credit a beneficiary', () => {
  it('the settlement handler returns before any balance movement when the bank executed', () => {
    const process = code('backend/src/modules/gateway/services/payoutOrchestration.process.ts');
    const guardIndex = process.indexOf('execution.paymentExecutionDelegatedToAspsp');
    const creditIndex = process.indexOf('creditDirect(db, execution.resolvedPayoutAccountReference');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(creditIndex).toBeGreaterThan(-1);
    // The guard must come FIRST and return, or the credit still happens for a delegated transfer.
    expect(guardIndex).toBeLessThan(creditIndex);
    const between = process.slice(guardIndex, creditIndex);
    expect(between).toContain('return;');
  });

  it('the transfer path records the delegation BEFORE dispatching', () => {
    const transfer = code('backend/src/modules/gateway/services/p2pTransfer.service.ts');
    const marker = transfer.indexOf('paymentExecutionDelegatedToAspsp');
    const dispatch = transfer.indexOf('initiatePaymentAtBank(');
    expect(marker).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    // Recorded first, because the settlement handler runs later and must know what was done rather than what
    // the configuration says by then.
    expect(marker).toBeLessThan(dispatch);
  });

  it('takes no local hold and releases none when the bank is the one holding', () => {
    const transfer = code('backend/src/modules/gateway/services/p2pTransfer.service.ts');
    // A local hold on a projection is a display artefact the next balance read erases.
    expect(transfer).toContain('delegateToBank ? true : await holdAvailableFunds');
    // And releasing a hold that was never taken would credit the customer.
    expect(transfer).toContain('if (!delegateToBank) await releaseReservation');
  });

  it('the PSP asks the DEBTOR bank, never the creditor institution', () => {
    const client = source('backend/src/providers/payment-initiation/services/bankcorePis.client.ts');
    expect(client).toContain('debtorAccount');
    // The reason is worth keeping in the file, since "just call the other bank" is the intuitive mistake.
    expect(client).toContain('not a clearing participant');
  });
});

describe('v37 N1: the terminal state is the PSP process\'s decision, not a handler\'s', () => {
  it('the notification receiver assigns no terminal payment state', () => {
    const receiver = code('backend/src/modules/provider/controllers/bankcoreNotification.controller.ts');
    const service = code('backend/src/modules/provider/services/bankcoreNotification.service.ts');
    for (const [name, body] of [['controller', receiver], ['service', service]] as const) {
      // `settled` is the bank's fact; `completed` is ours. A handler writing the latter would take a decision
      // that belongs to the process that owns the payment.
      expect(body, `${name} must not transition an execution`).not.toMatch(/transitionExecution\s*\(/);
      expect(body, `${name} must not write paymentExecutionStatus`).not.toMatch(/paymentExecutionStatus\s*:/);
    }
  });

  it('the receiver re-emits on the bus instead, which is what keeps the process in charge', () => {
    const receiver = code('backend/src/modules/provider/controllers/bankcoreNotification.controller.ts');
    expect(receiver).toContain('getEventBus().publish');
    // The name the existing orchestration already subscribes to: renaming it would leave transfers pending.
    const service = code('backend/src/modules/provider/services/bankcoreNotification.service.ts');
    expect(service).toContain("'bank.transfer.settled'");
  });

  it('the process, and only the process, completes the execution', () => {
    const process = code('backend/src/modules/gateway/services/payoutOrchestration.process.ts');
    expect(process).toMatch(/transitionExecution\(db, execRef, 'completed'/);
  });
});

describe('v37 N2: the blocking controls stay before dispatch', () => {
  it('the risk gate runs before anything is initiated at the bank', () => {
    const transfer = code('backend/src/modules/gateway/services/p2pTransfer.service.ts');
    const gate = transfer.search(/screen(Transfer)?[\s\S]{0,40}=|screen\.hold/);
    const dispatch = transfer.indexOf('initiatePaymentAtBank(');
    expect(gate).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    // After the bank presents the operation to a scheme the payment is irrevocable, and what exists is a
    // recall the creditor's bank may refuse. A control moved after dispatch stops being preventive.
    expect(gate).toBeLessThan(dispatch);
  });
});
