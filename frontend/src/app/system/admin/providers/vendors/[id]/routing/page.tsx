'use client';
import { useEffect, useState } from 'react';
import { Plus, Check, Users } from 'lucide-react';
import { useIntegration } from '../_context';
import { Card } from '../_shared';
import { api } from '../../../../../../../lib/api';
import { useConfirm, useNotify } from '../../../../../../../components/ui/ConfirmProvider';

interface RoutingGroup {
  routingGroupInstanceReference: string;
  routingGroupName: string;
  routingGroupStrategy: string;
  routingGroupStatus: string;
  routingGroupMembers: Array<{
    externalProviderArrangementInstanceReference: string;
    externalProviderArrangementName?: string;
    routingPriority?: number;
    routingWeight?: number;
  }>;
}

const STRATEGY_LABEL: Record<string, { label: string; description: string }> = {
  primary_fallback: {
    label: 'Primary / Fallback',
    description: 'All requests go to the highest-priority member. If it fails or is suspended, the next member takes over automatically.',
  },
  round_robin: {
    label: 'Round Robin',
    description: 'Requests are distributed evenly across all active members in rotation.',
  },
  weighted: {
    label: 'Weighted',
    description: 'Each member receives a configurable percentage of traffic. Useful for gradual rollouts or A/B testing.',
  },
  parallel: {
    label: 'Parallel',
    description: 'All members are called simultaneously. The first successful response wins. Lowest latency, highest resource cost.',
  },
};

export default function RoutingPage() {
  const { integration, reload, token } = useIntegration();
  const confirm = useConfirm();
  const notify = useNotify();
  const [groups, setGroups]           = useState<RoutingGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [newName, setNewName]         = useState('');
  const [newStrategy, setNewStrategy] = useState('primary_fallback');
  const [creating, setCreating]       = useState(false);
  const [joining, setJoining]         = useState<string | null>(null);
  const [leaving, setLeaving]         = useState(false);

  if (!integration) return null;

  const id         = integration.externalProviderArrangementInstanceReference;
  const isInternal = integration.externalProviderIsInternal;
  const type       = integration.externalProviderArrangementType;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    api.integrationGroups.list(token, { type })
      .then(r => setGroups(r.groups as unknown as RoutingGroup[]))
      .catch(() => {})
      .finally(() => setLoadingGroups(false));
  }, [token, type]);

  const currentGroup = groups.find(g => g.routingGroupInstanceReference === integration.routingGroupId);
  const memberInGroup = (g: RoutingGroup) =>
    g.routingGroupMembers?.some(m => m.externalProviderArrangementInstanceReference === id);

  async function handleJoin(groupId: string) {
    setJoining(groupId);
    try {
      await api.integrationGroups.addMember(groupId, { providerId: id }, token);
      const r = await api.integrationGroups.list(token, { type });
      setGroups(r.groups as unknown as RoutingGroup[]);
      reload(true);
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setJoining(null); }
  }

  async function handleLeave() {
    if (!integration?.routingGroupId) return;
    const ok = await confirm({
      title: 'Leave routing group?',
      message: 'This integration will stop receiving routed traffic from this group.',
      confirmLabel: 'Leave group',
      tone: 'danger',
    });
    if (!ok) return;
    setLeaving(true);
    try {
      await api.integrationGroups.removeMember(integration.routingGroupId!, id, token);
      const r = await api.integrationGroups.list(token, { type });
      setGroups(r.groups as unknown as RoutingGroup[]);
      reload(true);
      notify('Removed from routing group.', 'success');
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setLeaving(false); }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.integrationGroups.create({ name: newName.trim(), providerType: type, strategy: newStrategy }, token);
      const r = await api.integrationGroups.list(token, { type });
      setGroups(r.groups as unknown as RoutingGroup[]);
      setNewName('');
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setCreating(false); }
  }

  // ── What is routing; explanation ─────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Explanation */}
      <Card title="What is a routing group?">
        <div className="text-sm text-gray-700 space-y-3 leading-relaxed">
          <p>
            A <strong>routing group</strong> lets you register multiple providers for the same integration type
            and define exactly how the PSP distributes requests between them.
          </p>
          <p>
            For example: you have a built-in fraud detection engine and an external scoring API.
            By adding both to a group with the <em>Primary / Fallback</em> strategy,
            the PSP will send all traffic to the external API and automatically fall back to the internal engine
            if the external one is unavailable.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {Object.entries(STRATEGY_LABEL).map(([key, { label, description }]) => (
              <div key={key} className="border rounded-lg p-3 bg-gray-50">
                <p className="font-medium text-gray-800 text-xs mb-1">{label}</p>
                <p className="text-xs text-gray-500">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Internal restriction */}
      {isInternal && (
        <div className="bg-slate-50 border rounded-xl p-4 text-sm text-gray-500">
          Built-in providers can be members of a routing group but are typically assigned the lowest priority
          so they act as the final fallback when all external providers fail.
        </div>
      )}

      {/* Current membership */}
      {currentGroup ? (
        <Card title="Current group membership">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{currentGroup.routingGroupName}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Strategy: <strong>{STRATEGY_LABEL[currentGroup.routingGroupStrategy]?.label ?? currentGroup.routingGroupStrategy}</strong>
                  {' · '}Priority: <strong>{integration.routingPriority ?? 100}</strong>
                  {' · '}Group status: <strong>{currentGroup.routingGroupStatus}</strong>
                </p>
              </div>
              <button onClick={handleLeave} disabled={leaving}
                className="text-xs px-2.5 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 shrink-0">
                {leaving ? 'Removing…' : 'Leave group'}
              </button>
            </div>

            {/* Members list */}
            <div>
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><Users size={11} />Members ({currentGroup.routingGroupMembers?.length ?? 0})</p>
              <div className="border rounded-lg overflow-hidden">
                {(currentGroup.routingGroupMembers ?? []).map(m => (
                  <div key={m.externalProviderArrangementInstanceReference}
                    className={`flex items-center justify-between px-3 py-2 border-b last:border-0 text-sm ${
                      m.externalProviderArrangementInstanceReference === id ? 'bg-green-50' : ''
                    }`}>
                    <div className="flex items-center gap-2">
                      {m.externalProviderArrangementInstanceReference === id && <Check size={12} className="text-green-600 shrink-0" />}
                      <span className="font-mono text-xs text-gray-600">{m.externalProviderArrangementInstanceReference}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {m.routingPriority != null && <span>priority {m.routingPriority}</span>}
                      {m.routingWeight   != null && <span>{m.routingWeight}%</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <div className="bg-gray-50 border rounded-xl p-4 text-sm text-gray-500">
          This integration is not part of any routing group; it handles all requests independently.
        </div>
      )}

      {/* Available groups */}
      {!loadingGroups && groups.length > 0 && (
        <Card title={`Available groups for ${type.replace('_', ' ')} providers`}>
          <div className="space-y-2">
            {groups.map(g => {
              const isMember = memberInGroup(g);
              const strategy = STRATEGY_LABEL[g.routingGroupStrategy];
              return (
                <div key={g.routingGroupInstanceReference}
                  className="flex items-center justify-between border rounded-lg px-3 py-2.5 bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{g.routingGroupName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {strategy?.label ?? g.routingGroupStrategy} · {g.routingGroupMembers?.length ?? 0} member(s) · {g.routingGroupStatus}
                    </p>
                  </div>
                  {isMember ? (
                    <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                      <Check size={11} />Member
                    </span>
                  ) : (
                    <button
                      onClick={() => handleJoin(g.routingGroupInstanceReference)}
                      disabled={joining === g.routingGroupInstanceReference}
                      className="text-xs px-2.5 py-1.5 rounded border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-50 transition-colors">
                      {joining === g.routingGroupInstanceReference ? 'Joining…' : 'Join group'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Create new group */}
      <Card title="Create a new routing group">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Group name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder={`${type.replace('_', '-')}-group-a`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Strategy</label>
              <select value={newStrategy} onChange={e => setNewStrategy(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {Object.entries(STRATEGY_LABEL).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          {newStrategy && STRATEGY_LABEL[newStrategy] && (
            <p className="text-xs text-gray-500">{STRATEGY_LABEL[newStrategy].description}</p>
          )}
          <button onClick={handleCreate} disabled={creating || !newName.trim()}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-300 hover:border-gray-600 text-gray-700 disabled:opacity-50 transition-colors">
            <Plus size={13} />{creating ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </Card>
    </div>
  );
}
