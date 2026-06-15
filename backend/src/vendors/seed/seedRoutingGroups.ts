import { Db } from 'mongodb';
import {
  EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION,
  EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION,
  IntegrationProviderType,
  IntegrationRoutingGroup,
  ExternalProviderArrangement,
} from '../../modules/providers/models/externalProviderArrangement.model';

interface DefaultGroupDef {
  id: string;
  type: IntegrationProviderType;
  name: string;
  bianServiceDomain: string;
  pciDssRequirements: string[];
}

const DEFAULT_GROUP_DEFS: DefaultGroupDef[] = [
  {
    id: 'default-group-fraud-detection',
    type: 'fraud_detection',
    name: 'Default Fraud Detection Group',
    bianServiceDomain: 'Fraud Evaluation',
    pciDssRequirements: ['Req 10.2.1', 'Req 12.3.1', 'Req 12.8.1'],
  },
  {
    id: 'default-group-hrp-sanctions',
    type: 'hrp_sanctions',
    name: 'Default HRP Sanctions Group',
    bianServiceDomain: 'Party Reference Data',
    pciDssRequirements: ['Req 12.8.1', 'Req 12.8.5'],
  },
  {
    id: 'default-group-kyc-identity',
    type: 'kyc_identity',
    name: 'Default KYC Identity Group',
    bianServiceDomain: 'Customer Agreement',
    pciDssRequirements: ['Req 8.1', 'Req 12.8.1'],
  },
  {
    id: 'default-group-kyb-business',
    type: 'kyb_business',
    name: 'Default KYB Business Group',
    bianServiceDomain: 'Merchant Relations',
    pciDssRequirements: ['Req 12.8.1', 'Req 12.8.3'],
  },
  {
    id: 'default-group-aml-monitoring',
    type: 'aml_monitoring',
    name: 'Default AML Monitoring Group',
    bianServiceDomain: 'Suspicious Activity Analysis',
    pciDssRequirements: ['Req 10.2.1', 'Req 12.3.1'],
  },
  {
    id: 'default-group-credit-bureau',
    type: 'credit_bureau',
    name: 'Default Credit Bureau Group',
    bianServiceDomain: 'Customer Credit Rating',
    pciDssRequirements: ['Req 12.8.1'],
  },
  {
    id: 'default-group-card-authorization',
    type: 'card_authorization',
    name: 'Default Card Authorization Group',
    bianServiceDomain: 'Card Authorization',
    pciDssRequirements: ['Req 3.3.1', 'Req 10.2.1'],
  },
  {
    id: 'default-group-card-issuer',
    type: 'card_issuer',
    name: 'Default Card Issuer Group',
    bianServiceDomain: 'Payment Card',
    pciDssRequirements: ['Req 3.3.1', 'Req 3.5.1', 'Req 8.3.6'],
  },
  {
    id: 'default-group-generic',
    type: 'generic',
    name: 'Default Generic Integration Group',
    bianServiceDomain: 'External Provider Arrangements',
    pciDssRequirements: ['Req 12.8.1'],
  },
];

export async function seedRoutingGroups(db: Db): Promise<void> {
  const groupsCol = db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION);
  const providersCol = db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION);
  const now = new Date();

  for (const def of DEFAULT_GROUP_DEFS) {
    // Find internal provider for this type (fallback terminal at priority=999)
    const internal = await providersCol.findOne({
      externalProviderArrangementType: def.type,
      externalProviderIsInternal: true,
    });

    const members = internal ? [{
      externalProviderArrangementInstanceReference: internal.externalProviderArrangementInstanceReference,
      memberPriority: 999,
      memberWeight: 0,
      memberRole: 'fallback' as const,
    }] : [];

    const group: IntegrationRoutingGroup = {
      routingGroupInstanceReference: def.id,
      routingGroupName: def.name,
      routingGroupProviderType: def.type,
      routingGroupStrategy: 'primary_fallback',
      routingGroupStatus: 'active',
      routingGroupMembers: members,
      isDefaultGroup: true,
      bianServiceDomain: def.bianServiceDomain,
      bianControlRecordType: 'ExternalProviderArrangementPortfolio',
      pciDssRequirements: def.pciDssRequirements,
      recordCreatedDateTime: now,
      recordUpdatedDateTime: now,
    };

    await groupsCol.updateOne(
      { routingGroupInstanceReference: def.id },
      { $setOnInsert: group },
      { upsert: true }
    );

    // Bind internal provider to this default group (idempotent)
    if (internal) {
      await providersCol.updateOne(
        { externalProviderArrangementInstanceReference: internal.externalProviderArrangementInstanceReference },
        { $set: { routingGroupId: def.id, routingPriority: 999, recordUpdatedDateTime: now } }
      );
    }
  }
}
