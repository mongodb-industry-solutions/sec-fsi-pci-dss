// v37 N5: sequence baseline, captured BEFORE the ledger moves and before a settlement starts arriving
// by webhook instead of on the in-process bus.
//
// This is the one regression the split can cause while every other unit test stays green: if a
// re-emitted settlement uses a different event name, or a subscriber is lost, transfers simply hang
// in `pending` and nothing fails.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import type { EventBus, EventHandler, Subscription, DomainEvent } from '@leafypay/eventbus';

// Records who subscribes to what, without running any handler.
class RecordingBus implements EventBus {
  readonly subscriptions: Array<{ eventType: string }> = [];
  subscribe(eventType: string, _handler: EventHandler): Subscription {
    void _handler;
    this.subscriptions.push({ eventType });
    return { unsubscribe: () => undefined };
  }
  async publish(_event: DomainEvent): Promise<void> { void _event; }
  async start(): Promise<void> { /* nothing to start */ }
  async stop(): Promise<void> { /* nothing to stop */ }
}

const db = {} as Db;

function subscribedTypes(register: (bus: RecordingBus) => void): string[] {
  const bus = new RecordingBus();
  register(bus);
  return bus.subscriptions.map((s) => s.eventType).sort();
}

describe('v37 N5: orchestration sequence baseline', () => {
  it('the settlement notification keeps every subscriber it has today', async () => {
    const { PayoutOrchestrationProcess } = await import('../../../../backend/src/modules/gateway/services/payoutOrchestration.process');
    const { RtpLifecycleProcess } = await import('../../../../backend/src/modules/gateway/services/rtpLifecycle.process');

    const payout = subscribedTypes((bus) => new PayoutOrchestrationProcess(db, bus).register());
    const rtp = subscribedTypes((bus) => new RtpLifecycleProcess(db, bus).register());

    // bank.transfer.settled is what the post-transfer work hangs off, on BOTH processes. After the
    // split it arrives over a webhook and is re-emitted, so it must keep exactly this name.
    expect(payout).toContain('bank.transfer.settled');
    expect(payout).toContain('bank.transfer.failed');
    expect(rtp).toContain('bank.transfer.settled');
    expect(rtp).toContain('bank.transfer.failed');

    expect({ payout, rtp }).toMatchSnapshot();
  });

  it('the post-transfer compliance process still hangs off the completion event', async () => {
    const { P2PComplianceProcess } = await import('../../../../backend/src/modules/gateway/services/p2pCompliance.process');
    const types = subscribedTypes((bus) => new P2PComplianceProcess(db, bus).register());
    expect(types).toContain('p2p.transfer.completed');
    expect(types).toMatchSnapshot();
  });

  it('the payment authorization saga keeps its subscription set', async () => {
    const { PaymentAuthorizationSaga } = await import('../../../../backend/src/modules/transaction/services/paymentAuthorization.saga');
    expect(subscribedTypes((bus) => new PaymentAuthorizationSaga(db, bus).register())).toMatchSnapshot();
  });

  it('the post-authorization process keeps its subscription set', async () => {
    const { PostAuthorizationProcess } = await import('../../../../backend/src/modules/transaction/services/postAuthorization.process');
    expect(subscribedTypes((bus) => new PostAuthorizationProcess(db, bus).register())).toMatchSnapshot();
  });
});

describe('v37 N5: the concurrent risk gate is not fused', () => {
  const dispatched: string[] = [];

  beforeEach(() => {
    dispatched.length = 0;
    vi.resetModules();
    vi.doMock('../../../../backend/src/modules/provider/services/integrationDispatch.service', () => ({
      dispatchProvider: async (_db: unknown, type: string) => {
        dispatched.push(type);
        return { responseBody: {} };
      },
    }));
  });

  it('dispatches fraud detection, sanctions and AML as three separate provider calls', async () => {
    const { screenTransfer } = await import('../../../../backend/src/modules/gateway/services/transferRiskGate');
    await screenTransfer(db, {
      transferRef: 'TRF-N5-BASELINE',
      amount: 100,
      currency: 'EUR',
      initiatorPartyRef: 'b0000001-0000-4000-8000-000000000001',
      sourceAccountRef: 'pao00001-0000-4000-8000-000000000001',
      destinationCountry: 'ES',
    });

    // P6 turns the issuer and these gates from loopback calls into remote ones. That is expected;
    // collapsing them into one composite call because it is now one hop is not.
    expect(dispatched.sort()).toEqual(['aml_monitoring', 'fraud_detection', 'hrp_sanctions']);
  });
});
