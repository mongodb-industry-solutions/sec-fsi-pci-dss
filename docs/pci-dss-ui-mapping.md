# PCI DSS requirement mapping (reference only)

This is where the PCI DSS requirement references used to live inline in the UI. They were removed
from every on-screen string, including debug mode, because a hardcoded requirement number is a
factual claim that drifts: the same control was labelled inconsistently across screens, and a stale
or wrong number in a compliance demo is worse than no number at all.

The mapping is kept here so the control story stays auditable. Treat it as documentation, not as an
attestation: the authoritative statements live in [PRD.md](PRD.md) and
[technical-spec.md](technical-spec.md), and the standard itself governs.

Captured from the UI on 2026-08-06, immediately before the references were stripped.

| Screen / source | Requirements referenced | Context |
|---|---|---|
| `/simulator/investigation/[caseId]` | Req 10, Req 3, Req 7 | <strong>PCI DSS v4.0:</strong> the complete investigation trail satisfies Req 10 (audit logging), Req 3 (CHD protection via QE), and Req 7 (role-based |
| `/simulator/payment` | PCI DSS Req 3.2 | <Tooltip text="Card verification value. Sent to the card issuer for authorization only, never stored or logged (PCI DSS Req 3.2). The demo issuer acce |
| `/system` | Req 7.2 | { label: 'Transactions', description: 'View all your past payments and transfers, including their status and any security review.', icon: ClipboardLis |
| `/system` | Req 3 | { label: 'New Payment', description: 'Pay a merchant with a saved card. Choose the merchant, amount and channel.', icon: PlusCircle, href: '/system/pa |
| `/system` | Req 3 | { label: 'Transfer', description: 'Send money to a saved contact, initiate a bank transfer, or create a payment link.', icon: ArrowLeftRight, href: '/ |
| `/system` | Req 3 | { label: 'Payment Methods', description: 'View and manage your saved cards. Only the last 4 digits are ever displayed.', icon: CreditCard, href: '/sys |
| `/system` | Req 3.3 | { label: 'Payout Accounts', description: 'Manage the bank accounts where you send and receive money.', icon: Landmark, href: '/system/accounts', pciDs |
| `/system` | Req 12 | { label: 'Merchants', description: 'Browse the merchants you can pay.', icon: Store, href: '/system/merchant', pciDss: 'Req 12' }, |
| `/system` | Req 8 | { label: 'Profile', description: 'View and update your personal details and contact information.', icon: User, href: '/system/profile', pciDss: 'Req 8 |
| `/system` | Req 10.4 | { label: 'Cases', description: 'Review open fraud cases. Search by case reference, email, phone or card, and escalate to L2 when needed.', icon: Brief |
| `/system` | Req 10.2 | { label: 'Transactions', description: 'Search and inspect card transactions across all customers.', icon: CreditCard, href: '/system/transactions', pc |
| `/system` | Req 12.3 | { label: 'Users', description: 'Look up customers by email, phone or account reference.', icon: Users, href: '/system/users', pciDss: 'Req 12.3' }, |
| `/system` | Req 12.8 | { label: 'Merchants', description: 'Browse merchants and review their KYB status and payment activity.', icon: Store, href: '/system/merchant', pciDss |
| `/system` | Req 10.4 | { label: 'Cases', description: 'Approve escalations, access full customer details, and resolve cases as fraud or cleared.', icon: BriefcaseMedical, hr |
| `/system` | Req 10.2 | { label: 'Transactions', description: 'Deep-dive transaction analysis with full access to gateway and processor details.', icon: CreditCard, href: '/s |
| `/system` | Req 12.3 | { label: 'Users', description: 'Full customer records and agreement detail.', icon: Users, href: '/system/users', pciDss: 'Req 12.3' }, |
| `/system` | Req 12.8 | { label: 'Merchants', description: 'Merchant due-diligence: identity, risk profile and payment activity.', icon: Store, href: '/system/merchant', pciD |
| `/system` | Req 10.4 | { label: 'Cases', description: 'Read-only view of every fraud case and its complete audit trail.', icon: BriefcaseMedical, href: '/system/investigatio |
| `/system` | Req 10.2.1 | { label: 'Transactions', description: 'Full transaction audit view, all fields visible, no modifications permitted.', icon: CreditCard, href: '/system |
| `/system` | Req 8.2 | { label: 'Users', description: 'Customer and staff account review: authentication records and role assignments.', icon: Users, href: '/system/users',  |
| `/system` | Req 10 | { label: 'Audit Log', description: 'Security event log: who did what and when, across all cases and users.', icon: BarChart3, href: '/system/audit', p |
| `/system` | Req 10.2 | { label: 'Audit Events', description: 'Unified activity log across payments, compliance checks and integrations.', icon: Activity, href: '/system/audi |
| `/system` | Req 10 | { label: 'Data Integrity', description: 'Check that all records are consistent and no data is missing or duplicated.', icon: ShieldCheck, href: '/syst |
| `/system` | Req 12.8 | { label: 'Merchant', description: 'Merchant compliance and lifecycle audit across the portfolio.', icon: Store, href: '/system/merchant', pciDss: 'Req |
| `/system` | Req 12.8 | { label: 'Review Queue', description: 'Approve or reject pending merchant applications.', icon: ClipboardCheck, href: '/system/merchant/review', pciDs |
| `/system` | Req 12.8 | { label: 'All Merchants',description: 'Full merchant portfolio with KYB status, activity and history.', icon: Store, href: '/system/merchant', pciDss: |
| `/system` | Req 8 | { label: 'My Profile', description: 'Manage your profile and contact details.', icon: User, href: '/system/profile', pciDss: 'Req 8' }, |
| `/system` | Req 12.8 | { label: 'Modules', description: 'Administer the internal capability engines (card issuer, AIS, FDS, AML, HRP...) and their business policies.', icon: |
| `/system` | Req 3.3 | { label: 'Cards', description: 'Global cardholder card administration: register, edit, activate/suspend and revoke saved cards.', icon: CreditCard, hr |
| `/system` | Req 3.3 | { label: 'Payout Accounts', description: 'Global payout-account administration: create, edit and close accounts. IBAN stays encrypted.', icon: Landmar |
| `/system` | Req 10.2 | { label: 'Audit Events', description: 'Follow how rules and configurations behave: card validation and connected-module outcomes (approved/rejected/er |
| `/system` | Req 10.2 / 10.7 | { label: 'Audit Events', description: 'Unified business, compliance and integration audit trail.', icon: Activity, href: '/system/audit-events', debug |
| `/system` | Req 12.8 | { label: 'Providers', description: 'External provider arrangements; register, route and monitor.', icon: Plug, href: '/system/admin/providers', debug: |
| `/system` | PCI DSS Req 12.8 | <p className="text-sm text-gray-500 mt-0.5">External Provider Arrangements · PCI DSS Req 12.8</p> |
| `/system` | PCI DSS Req 3/7 | {debugMode && <span className="text-[10px] font-mono text-gray-400">· aggregates only · PCI DSS Req 3/7</span>} |
| `/system/accounts` | PCI DSS Req 3.3 | <p className="text-xs text-gray-400 mt-0.5">PCI DSS Req 3.3</p> |
| `/system/accounts` | PCI DSS Req 3.3 | <span>IBAN and routing number are stored encrypted at rest (MongoDB Queryable Encryption · PCI DSS Req 3.3). Only authorised Level 2 users can decrypt |
| `/system/accounts` | PCI DSS Req 3.3, Req 10, Req 7 | debugInfo="Payout Account · PCI DSS Req 3.3 (IBAN encrypted QE) · Req 7 (partyRef JWT-scoped) · Req 10 (audited)" |
| `/system/accounts/[accountId]` | PCI DSS Req 3.3 | title={ibanRevealed ? 'Hide IBAN' : 'Reveal IBAN (PCI DSS Req 3.3)'} |
| `/system/admin` | PCI DSS Req 12.8 | ? 'External Provider Arrangements · PCI DSS Req 12.8' |
| `/system/admin/events` | PCI DSS Req 10.2.1 / 10.3 / 10.7 | debugInfo="ADR-025 · businessProcessEvent + complianceProcessEvent (timeseries) · PCI DSS Req 10.2.1 / 10.3 / 10.7" |
| `/system/admin/modules` | PCI DSS Req 12.8 | debugInfo="§2.6 module-type label · ADR-029 · capabilityModuleConfiguration · PCI DSS Req 12.8" |
| `/system/admin/modules/account-information` | PCI Req 7, Req 10 | debugInfo="capability=account-information Payout Account Arrangement · GDPR/PSD2 · PCI Req 7 · Req 10" |
| `/system/admin/modules/account-information/accounts/[accountRef]` | PCI DSS Req 10 | <p className="text-xs text-gray-400 pt-1">IBAN and routing number are QE-encrypted at rest. The IBAN reveal is on demand (need-to-know, re-hideable) a |
| `/system/admin/modules/aml` | PCI DSS Req 12.8 / Req 10 | <SectionHeader icon={ScanSearch} title="AML Monitoring" description="Anti-money-laundering screening and suspicious-activity analysis." debugInfo="cap |
| `/system/admin/modules/card-issuer` | PCI DSS Req 3.2, Req 10. | <strong>Logging:</strong> every validation request records a compliance event with the request and response payloads and the linked transaction id / c |
| `/system/admin/modules/card-issuer` | PCI DSS Req 3.2/3.3, Req 10, Req 7 | debugInfo="capability=card-issuer Payment Card · PCI DSS Req 3.2/3.3 (no SAD stored) · Req 7 · Req 10" |
| `/system/admin/modules/card-issuer/cards/[cardId]` | PCI DSS Req 3.2/3.3, Req 10 | <p className="text-xs text-gray-400 pt-1">Cardholder is derived from the linked party (need-to-know, audited). Full PAN and CVV are never stored. Any  |
| `/system/admin/modules/domains/[id]/users/[userId]` | PCI DSS Req 3.3 | <p className="text-[10px] text-gray-400 mt-0.5">Immutable; QE-encrypted at rest and masked by default (PCI DSS Req 3.3 / data minimization).</p> |
| `/system/admin/modules/fds` | PCI DSS Req 12.8 / Req 10 | debugInfo="capability=fds Fraud Evaluation · PCI DSS Req 12.8 / Req 10 (config audited)" |
| `/system/admin/modules/fds` | PCI DSS Req 3.2 | <strong>How it scores: </strong> every transaction is evaluated against the enabled rules. The fired rules&rsquo; scores sum to the risk score; the ba |
| `/system/admin/modules/hrp` | PCI DSS Req 12.8 / Req 10 | <SectionHeader icon={ShieldAlert} title="HRP / Sanctions" description="High-risk person / counterparty and sanctions / PEP screening." debugInfo="capa |
| `/system/admin/modules/kyb` | PCI Req 7/12.8 | <SectionHeader icon={Building2} title="KYB: Know Your Business" description="Merchant onboarding verification engine and the KYB administration workbe |
| `/system/admin/modules/kyb/[merchantId]` | PCI Req 10 | <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">KYB data<Tooltip text="KYB data fields (legal entity, MCC, notes). This  |
| `/system/admin/modules/kyb/[merchantId]` | PCI Req 10.7 | <Tooltip text="Every event of the KYB journey by correlationId: bus milestones (*.requested/*.completed) and provider wire calls (sanitized request/re |
| `/system/admin/modules/kyc` | PCI Req 7/8/10/12.8 | <SectionHeader icon={UserCheck} title="KYC: Know Your Customer" description="Customer onboarding verification engine and the KYC administration workbe |
| `/system/admin/modules/kyc/[partyInstanceReference]` | PCI Req 3.2/3.3, Req 10 | <Tooltip text="QE:none fields (encrypted at rest, NOT searchable): residential/postal address, source of funds, purpose of relationship, risk notes. H |
| `/system/admin/modules/kyc/[partyInstanceReference]` | PCI Req 10 | <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">KYC data<Tooltip text="KYC data fields (occupation, source of funds, pur |
| `/system/admin/modules/kyc/[partyInstanceReference]` | PCI Req 10.7 | <Tooltip text="Every event of the KYC journey by correlationId (= partyInstanceReference): bus milestones and provider wire calls (sanitized, PCI Req  |
| `/system/admin/modules/vop` | PCI DSS Req 12.8 / Req 10 | <SectionHeader icon={ShieldCheck} title="Verification of Payee (VoP)" description="Payee name-vs-account confirmation. Additional to FDS/AML/HRP; mark |
| `/system/admin/providers` | PCI DSS Req 12.8.1 | debugInfo="ExternalProviderArrangement · PCI DSS Req 12.8.1" |
| `/system/admin/providers` | PCI DSS Req 12.8.1 | {ROLE_LABELS['manager']} · PCI DSS Req 12.8.1; maintained list of all third-party service providers |
| `/system/admin/roles` | PCI DSS Req 7 | debugInfo="ADR-030 Party Authentication · PCI DSS Req 7 (RBAC, least privilege, documented matrix)" |
| `/system/audit` | PCI DSS Req 10 | debugInfo="(append-only events) · PCI DSS Req 10 (logging & monitoring) · ADR-025 (businessProcessEvent timeseries)" |
| `/system/audit` | PCI DSS Req 10 | <p className="font-semibold text-gray-700 mb-1">PCI DSS Req 10</p> |
| `/system/audit-events` | PCI DSS Req 10.2 / 10.3 / 10.7 | debugInfo="ADR-025 · businessProcessEvent + complianceProcessEvent + integrationEvents · PCI DSS Req 10.2 / 10.3 / 10.7" |
| `/system/beneficiaries` | PCI DSS Req 3.4 | note: 'Contact details are stored masked (PCI DSS Req 3.4). Each read is recorded in the compliance ledger.', |
| `/system/beneficiaries` | PCI DSS Req 3.4, Req 7 | debugInfo="Counterparty Administration · PCI DSS Req 3.4 · Req 7 (scope: own for customers)" |
| `/system/beneficiaries` | PCI DSS Req 3.4 | . Contact details are masked at registration (PCI DSS Req 3.4) and this read is recorded in |
| `/system/cards` | PCI DSS Req 3, Req 10, Req 7 | debugInfo="Payment Card · PCI DSS Req 3 (no PAN/CVV) · Req 7 (own cards only) · Req 10 (audited)" |
| `/system/cards/new` | PCI DSS Req 3.2 / 3.4 | {debugMode ? ' (PCI DSS Req 3.2 / 3.4; expiry is QE:none, token is a surrogate).' : '.'} |
| `/system/help` | Req 1.1.1, 1.1.2. | { id: '1.1', text: 'Document and publish a network security control (NSC) policy and assign roles and responsibilities', detail: 'Req 1.1.1, 1.1.2. Mu |
| `/system/help` | Req 1.2.3, 1.2.4. | { id: '1.2', text: 'Maintain current network topology diagrams showing all CDE connections and data-flow diagrams', detail: 'Req 1.2.3, 1.2.4. Update  |
| `/system/help` | Req 1.2.1, 1.3.1, 1.3.2., Req 1.2.5, 1.2.6 | { id: '1.3', text: 'Configure all NSCs with deny-all default; allow only explicitly justified services, protocols, and ports', detail: 'Req 1.2.1, 1.3 |
| `/system/help` | Req 1.3.3. | { id: '1.4', text: 'Install NSCs between all wireless networks and the CDE with deny-all default', detail: 'Req 1.3.3. Required even if wireless is co |
| `/system/help` | Req 1.4.3. | { id: '1.5', text: 'Implement anti-spoofing measures to detect and block forged source IP addresses', detail: 'Req 1.4.3. Prevents source IP spoofing  |
| `/system/help` | Req 1.4.4. | { id: '1.6', text: 'Ensure CHD storage systems are not directly accessible from untrusted networks', detail: 'Req 1.4.4. Databases, file servers, and  |
| `/system/help` | Req 1.4.5. | { id: '1.7', text: 'Restrict disclosure of internal IP addresses and routing information to external parties', detail: 'Req 1.4.5. Prevents network re |
| `/system/help` | Req 1.2.7. | { id: '1.8', text: 'Review NSC configurations at least every six months and correct identified weaknesses', detail: 'Req 1.2.7. Document review result |
| `/system/help` | Req 1.5.1. | { id: '1.9', text: 'Apply security controls to all employee devices connecting to both untrusted networks and the CDE', detail: 'Req 1.5.1. Laptops an |
| `/system/help` | Req 2.2.1. | { id: '2.1', text: 'Develop, implement, and maintain configuration standards for all system components', detail: 'Req 2.2.1. Standards must align with |
| `/system/help` | Req 2.2.2. | { id: '2.2', text: 'Change or disable all vendor-supplied default accounts and passwords before installation', detail: 'Req 2.2.2. Default credentials |
| `/system/help` | Req 2.2.3. | { id: '2.3', text: 'Separate primary functions requiring different security levels onto separate system components', detail: 'Req 2.2.3. Web servers a |
| `/system/help` | Req 2.2.4. | { id: '2.4', text: 'Enable only necessary functions, components, ports, protocols, and services', detail: 'Req 2.2.4. Disable all unused features on o |
| `/system/help` | Req 2.2.7. | { id: '2.5', text: 'Encrypt all non-console administrative access (SSH, RDP, web-based management) with strong cryptography', detail: 'Req 2.2.7. Clea |
| `/system/help` | Req 2.3.1, 2.3.2. | { id: '2.6', text: 'Change all wireless vendor defaults at installation: SSIDs, passwords, SNMP community strings, and encryption keys', detail: 'Req  |
| `/system/help` | Req 3.6.1.1 | frequency: 'Data retention policies enforced continuously; crypto architecture reviewed annually (Req 3.6.1.1).', |
| `/system/help` | Req 3.1.1, 3.2.1. | { id: '3.1', text: 'Define and enforce a data retention and disposal policy; store account data only as long as necessary', detail: 'Req 3.1.1, 3.2.1. |
| `/system/help` | Req 3.3.1. | { id: '3.2', text: 'Never store Sensitive Authentication Data (SAD) after authorization is complete', detail: 'Req 3.3.1. SAD includes full track data |
| `/system/help` | Req 3.4.1, 3.5.1.1. | { id: '3.3', text: 'Render PAN unreadable using AES-256 encryption, truncation, HMAC keyed hashing, or index tokens with separate vault', detail: 'Req |
| `/system/help` | Req 3.4.2. | { id: '3.4', text: 'Implement technical controls to prevent PAN copy/paste or relocation via remote access tools', detail: 'Req 3.4.2. Restricts clipb |
| `/system/help` | Req 3.6.1, 3.7.1 | { id: '3.5', text: 'Implement full key management lifecycle: generation, distribution, storage, retirement, replacement, destruction', detail: 'Req 3. |
| `/system/help` | Req 3.6.1.1. | { id: '3.6', text: 'Document your cryptographic architecture: all algorithms, protocols, keys, key strengths, and key custodians', detail: 'Req 3.6.1. |
| `/system/help` | Req 3.5.1, 12.3.3. | { id: '3.7', text: 'Use only strong cryptography: RSA 2048+, AES-128/256, ECDSA P-256+, and TLS 1.2+; review cipher suite list annually', detail: 'Req |
| `/system/help` | Req 4.2.1. | { id: '4.1', text: 'Use strong cryptography (TLS 1.2+) for all PAN transmissions over open, public networks', detail: 'Req 4.2.1. Open networks includ |
| `/system/help` | Req 4.2.1.1. | { id: '4.2', text: 'Maintain an inventory of all trusted keys and certificates used to protect PAN in transit', detail: 'Req 4.2.1.1. Inventory must i |
| `/system/help` | Req 4.2.1. | { id: '4.3', text: 'Accept only valid, non-expired, non-revoked certificates from trusted certificate authorities', detail: 'Req 4.2.1. Implement cert |
| `/system/help` | Req 4.2.2. | { id: '4.4', text: 'Never transmit PANs via unprotected end-user messaging technologies', detail: 'Req 4.2.2. Covers SMS, email, instant messaging, an |
| `/system/help` | Req 4.1.1, 4.1.2. | { id: '4.5', text: 'Document a cardholder data transmission policy with assigned roles and responsibilities', detail: 'Req 4.1.1, 4.1.2. Policy must e |
| `/system/help` | Req 5.2.1, 5.2.3., Req 5.3.3 | { id: '5.1', text: 'Deploy anti-malware solutions on all system components; evaluate systems not commonly at risk periodically', detail: 'Req 5.2.1, 5 |
| `/system/help` | Req 5.2.2. | { id: '5.2', text: 'Ensure anti-malware detects viruses, worms, Trojans, spyware, rootkits, ransomware, and adware', detail: 'Req 5.2.2. Solution must |
| `/system/help` | Req 5.3.1, 5.3.2. | { id: '5.3', text: 'Enable automatic signature/definition updates and real-time or continuous behavioral scanning', detail: 'Req 5.3.1, 5.3.2. Schedul |
| `/system/help` | Req 10, Req 5.3.4. | { id: '5.4', text: 'Enable and retain anti-malware audit logs per the audit log retention policy (Req 10)', detail: 'Req 5.3.4. Malware detection even |
| `/system/help` | Req 5.3.5. | { id: '5.5', text: 'Prevent users from disabling or altering anti-malware without documented management authorization per-case', detail: 'Req 5.3.5. A |
| `/system/help` | Req 5.4.1. | { id: '5.6', text: 'Implement DMARC, SPF, and DKIM to protect personnel from phishing attacks targeting the CDE', detail: 'Req 5.4.1. DMARC policy at  |
| `/system/help` | Req 6.2.1, 6.2.2. | { id: '6.1', text: 'Implement a secure SDLC; train all developers in software security at least annually', detail: 'Req 6.2.1, 6.2.2. Training must co |
| `/system/help` | Req 6.2.3, 6.2.3.1. | { id: '6.2', text: 'Review all custom and bespoke software for security vulnerabilities before every production release', detail: 'Req 6.2.3, 6.2.3.1. |
| `/system/help` | Req 6.2.4. | { id: '6.3', text: 'Prevent/mitigate OWASP Top 10 vulnerabilities: injection, XSS, broken auth, IDOR, and CSRF in all custom code', detail: 'Req 6.2.4 |
| `/system/help` | Req 6.3.3. | { id: '6.4', text: 'Apply critical security patches within 1 month of release; apply all other patches within 6 months', detail: 'Req 6.3.3. Critical  |
| `/system/help` | Req 6.3.2. | { id: '6.5', text: 'Maintain a software inventory (SBOM-equivalent) for all bespoke and custom software including third-party libraries', detail: 'Req |
| `/system/help` | Req 6.4.1, 6.4.2. | { id: '6.6', text: 'Deploy and maintain a WAF for all public-facing web applications that actively blocks web attacks', detail: 'Req 6.4.1, 6.4.2. Aut |
| `/system/help` | Req 6.4.3. | { id: '6.7', text: 'For payment pages: inventory all scripts, authorize each one, and verify integrity (SRI hashes or CSP)', detail: 'Req 6.4.3. Addre |
| `/system/help` | Req 6.5.1 | { id: '6.8', text: 'Separate development, test, and production environments; prohibit live/production data in test environments', detail: 'Req 6.5.1 t |
| `/system/help` | Req 7.2.1. | { id: '7.1', text: 'Implement a least-privilege, need-to-know access control model with deny-all as the default', detail: 'Req 7.2.1. Every access gra |
| `/system/help` | Req 7.2.2, 7.2.3. | { id: '7.2', text: 'Assign access aligned strictly with job classification and function; require formal approval for all access grants', detail: 'Req  |
| `/system/help` | Req 7.2.4. | { id: '7.3', text: 'Review all user accounts and associated access privileges at least every six months', detail: 'Req 7.2.4. Accounts that no longer  |
| `/system/help` | Req 7.2.5, 7.2.5.1. | { id: '7.4', text: 'Formally manage and periodically review all application and system account access privileges', detail: 'Req 7.2.5, 7.2.5.1. Servic |
| `/system/help` | Req 7.2.6. | { id: '7.5', text: 'Restrict all cardholder data repository queries to programmatic methods only; prohibit direct query tool access', detail: 'Req 7.2 |
| `/system/help` | Req 7.3.1 | { id: '7.6', text: 'Deploy an access control system enforcing all access assignments with default set to "deny all"', detail: 'Req 7.3.1 to 7.3.3. IAM |
| `/system/help` | Req 8.2.1. | { id: '8.1', text: 'Assign a unique ID to every user before granting access to any system component or cardholder data', detail: 'Req 8.2.1. Shared ac |
| `/system/help` | Req 8.2.4, 8.2.5. | { id: '8.2', text: 'Manage the full user ID lifecycle: add, modify, suspend, and delete accounts through a formal identity management process', detail |
| `/system/help` | Req 8.2.6. | { id: '8.3', text: 'Disable inactive user accounts within 90 days of inactivity', detail: 'Req 8.2.6. Set automated account expiry in your IAM system. |
| `/system/help` | Req 8.3.4. | { id: '8.4', text: 'Lock accounts after a maximum of 10 consecutive failed authentication attempts', detail: 'Req 8.3.4. Lockout duration must be at l |
| `/system/help` | Req 8.3.6. | { id: '8.5', text: 'Enforce passwords/passphrases of at least 12 characters containing both numeric and alphabetic characters', detail: 'Req 8.3.6. If |
| `/system/help` | Req 8.4.2. | { id: '8.6', text: 'Implement MFA for ALL access into the CDE; every user, every role, every location, every method', detail: 'Req 8.4.2. One of the m |
| `/system/help` | Req 8.4.3. | { id: '8.7', text: 'Implement MFA for all remote network access originating from outside the entity\'s network that could impact the CDE', detail: 'Re |
| `/system/help` | Req 8.5.1. | { id: '8.8', text: 'Ensure MFA implementation is replay-proof and cannot be bypassed by any user including administrators', detail: 'Req 8.5.1. MFA by |
| `/system/help` | Req 8.6.2. | { id: '8.9', text: 'Prohibit hard-coded passwords in scripts, configuration files, and source code', detail: 'Req 8.6.2. Use secrets management soluti |
| `/system/help` | Req 8.2.8. | { id: '8.10', text: 'Re-authenticate idle sessions after 15 minutes of inactivity', detail: 'Req 8.2.8. Applies to all CDE-facing applications, admin  |
| `/system/help` | Req 9.2.1. | { id: '9.1', text: 'Implement appropriate physical entry controls to restrict access to the CDE and sensitive areas', detail: 'Req 9.2.1. Includes bad |
| `/system/help` | Req 9.2.2. | { id: '9.2', text: 'Monitor sensitive areas with video surveillance or equivalent physical access control mechanisms', detail: 'Req 9.2.2. Footage mus |
| `/system/help` | Req 9.3.2 | { id: '9.3', text: 'Implement a visitor management process: issue visitor badges, escort visitors, and maintain a visitor log', detail: 'Req 9.3.2 to  |
| `/system/help` | Req 9.4.2 | { id: '9.4', text: 'Classify all media containing cardholder data by sensitivity level; approve and log all media movements outside the facility', det |
| `/system/help` | Req 9.4.6, 9.4.7. | { id: '9.5', text: 'Destroy all hard-copy materials containing PAN when no longer needed; render electronic media with CHD unrecoverable', detail: 'Re |
| `/system/help` | Req 9.5.1 | { id: '9.6', text: 'Maintain an inventory of all POI devices and inspect them periodically for tampering', detail: 'Req 9.5.1 to 9.5.1.2. Visual inspe |
| `/system/help` | Req 9.5.1.3. | { id: '9.7', text: 'Train all POI-handling personnel to identify tampering, unauthorized substitution, and social engineering attempts', detail: 'Req  |
| `/system/help` | Req 10.2.1, 10.2.1.1. | { id: '10.1', text: 'Enable audit logging on all CDE systems: all user access to CHD, admin actions, invalid login attempts, and access mechanism chan |
| `/system/help` | Req 10.2.2, 10.3.1. | { id: '10.2', text: 'Protect audit logs from unauthorized modification and deletion; changes must generate alerts', detail: 'Req 10.2.2, 10.3.1. Logs  |
| `/system/help` | Req 10.3.3. | { id: '10.3', text: 'Promptly back up audit logs to a centralized log server or other media that is difficult to alter', detail: 'Req 10.3.3. Central  |
| `/system/help` | Req 10.4.1, 10.4.1.1. | { id: '10.4', text: 'Implement automated mechanisms (SIEM) to review security logs from all CDE systems at least daily', detail: 'Req 10.4.1, 10.4.1.1 |
| `/system/help` | Req 10.5.1. | { id: '10.5', text: 'Retain audit logs for at least 12 months with the most recent 3 months immediately available for analysis', detail: 'Req 10.5.1.  |
| `/system/help` | Req 10.6.1 | { id: '10.6', text: 'Synchronize all CDE system clocks from a trusted, industry-accepted time source', detail: 'Req 10.6.1 to 10.6.3. NTP from reliabl |
| `/system/help` | Req 10.7.2, 10.7.3. | { id: '10.7', text: 'Detect, alert on, and address promptly any failures of critical security controls', detail: 'Req 10.7.2, 10.7.3. Critical control |
| `/system/help` | Req 11.3.1, 11.3.1.2. | { id: '11.1', text: 'Perform internal vulnerability scans at least every three months using authenticated scanning', detail: 'Req 11.3.1, 11.3.1.2. Re |
| `/system/help` | Req 11.3.2. | { id: '11.2', text: 'Perform external vulnerability scans via an Approved Scanning Vendor (ASV) at least every three months', detail: 'Req 11.3.2. Onl |
| `/system/help` | Req 11.4.1, 11.4.2. | { id: '11.3', text: 'Conduct internal and external penetration testing at least annually and after any significant infrastructure or application chang |
| `/system/help` | Req 11.4.3. | { id: '11.4', text: 'If using network segmentation to isolate the CDE, test segmentation effectiveness at least annually (service providers: every 6 m |
| `/system/help` | Req 11.4.5. | { id: '11.5', text: 'Deploy IDS/IPS to detect and/or prevent intrusions into the CDE; update signatures regularly', detail: 'Req 11.4.5. Alerts must r |
| `/system/help` | Req 11.5.2. | { id: '11.6', text: 'Implement file integrity monitoring (FIM) on critical system files; review alerts and perform comparisons at least weekly', detai |
| `/system/help` | Req 11.6.1. | { id: '11.7', text: 'Deploy change-and-tamper detection for payment page HTTP headers and script contents; evaluate at least weekly', detail: 'Req 11. |
| `/system/help` | Req 11.2.1. | { id: '11.8', text: 'Manage wireless access point detection quarterly; alert on unauthorized APs within 24 hours', detail: 'Req 11.2.1. Use wireless i |
| `/system/help` | Req 12.1.1, 12.1.2. | { id: '12.1', text: 'Publish and maintain an information security policy; review and update it at least annually', detail: 'Req 12.1.1, 12.1.2. Policy |
| `/system/help` | Req 12.1.4. | { id: '12.2', text: 'Formally assign information security responsibility to a CISO or equivalent security-knowledgeable executive', detail: 'Req 12.1. |
| `/system/help` | Req 12.3.1. | { id: '12.3', text: 'Conduct a Targeted Risk Analysis (TRA) for each PCI DSS requirement that specifies a "periodic" activity without a defined freque |
| `/system/help` | Req 12.3.3. | { id: '12.4', text: 'Review cryptographic cipher suites and protocols in use at least annually; plan removal of deprecated algorithms', detail: 'Req 1 |
| `/system/help` | Req 12.5.2. | { id: '12.5', text: 'Document and confirm the PCI DSS scope at least annually and upon significant change; obtain written executive sign-off', detail: |
| `/system/help` | Req 12.6.1, 12.6.3. | { id: '12.6', text: 'Conduct a security awareness training program for all personnel upon hire and at least annually; include phishing and social engi |
| `/system/help` | Req 12.7.1. | { id: '12.7', text: 'Screen all personnel with CDE access prior to hire; conduct background checks appropriate to their level of access', detail: 'Req |
| `/system/help` | Req 12.8.1 | { id: '12.8', text: 'Maintain a list of all third-party service providers (TPSPs) with written agreements documenting PCI DSS responsibility allocatio |
| `/system/help` | Req 12.10.1 | { id: '12.9', text: 'Maintain and test an incident response plan annually; ensure 24/7 availability of incident response contacts', detail: 'Req 12.10 |
| `/system/help` | Req 12.10.7. | { id: '12.10', text: 'Define incident response procedures for PAN found in unexpected locations; include response, notification, and isolation steps', |
| `/system/help` | Req 7 | description: 'Atlas RBAC supports granular roles at the database, collection, and field level. Combined with LDAP integration, your existing corporate |
| `/system/help` | Req 10.4.1.1 | description: 'Atlas audit logging captures every authentication attempt, authorization decision, and data operation with user ID, timestamp, source IP |
| `/system/help` | Req 3 | and the security controls map to <span className="text-gray-200 font-medium">PCI DSS v4.0.1</span> (Req 3 |
| `/system/help` | Req 10, Req 7/8 | encryption, Req 7/8 access control, Req 10 logging). BIAN gives an industry-standard structure; PCI DSS gives |
| `/system/help` | Req 3 | { req: 'Req 3', title: 'Stored Data Protection', desc: 'Full PAN only in the issuer module vault (QE); PSP core keeps token + BIN + last4; CVV derived |
| `/system/help` | Req 7, 8 | { req: 'Req 7, 8', title: 'Access Control and Auth', desc: 'Data-driven RBAC (ADR-030); each role gets the minimum data access.' }, |
| `/system/help` | Req 10 | { req: 'Req 10', title: 'Audit Logging', desc: 'Every case action logged with user, timestamp, and action type.' }, |
| `/system/help` | Req 7 | Access in this platform follows PCI DSS <span className="text-gray-200 font-medium">least-privilege, need-to-know</span> (Req 7): |
| `/system/help` | Req. | ['CMK', 'Customer Master Key; the KMS-held key that wraps the DEKs. Never leaves the KMS (Req. 3.6, 3.7).'], |
| `/system/help` | Req. | ['SIEM', 'Security Information and Event Management; centralizes and correlates audit logs for daily review (Req. 10.4).'], |
| `/system/help` | Req 6.4.2 | items: ['Application-layer encryption; MongoDB driver encrypts PAN before sending to Atlas (CSFLE/QE).', 'No plaintext PAN in application logs or erro |
| `/system/help` | Req 3.7 | items: ['AWS KMS / Azure Key Vault / GCP Cloud KMS / KMIP for master key management.', 'Envelope encryption; data keys encrypted by master keys you co |
| `/system/help` | Req 3.6 | desc: 'Full cryptographic key sovereignty. Your KMS encrypts data keys; MongoDB never has access to your master keys. Satisfies Req 3.6 to 3.7 key man |
| `/system/help` | Req 1 | desc: 'Private Endpoints ensure all CDE traffic stays on cloud-provider backbone. Combined with IP allowlisting, creates a verifiable CDE network boun |
| `/system/help` | Req 10.4.1.1 | desc: 'Field-level audit logging forwarded to SIEM in real time. Automated daily review satisfies the new Req 10.4.1.1 requirement for automated log r |
| `/system/help` | Req 7 | desc: 'Granular role-based access at database and collection level. LDAP/AD integration, OIDC/SCIM provisioning, and workforce identity federation sat |
| `/system/integrity` | PCI DSS Req 10 | debugInfo="control-record integrity · PCI DSS Req 10 (logging & monitoring) · read-only" |
| `/system/investigation` | PCI DSS Req 10.4 | debugInfo="Fraud Diagnosis · PCI DSS Req 10.4 (audit trail)" |
| `/system/merchant` | PCI DSS Req 12.8 | PCI DSS Req 12.8 · documented merchant agreement required before processing payments |
| `/system/merchant` | PCI DSS Req 12.8 | <span className="text-gray-500 text-xs font-mono">PCI DSS Req 12.8</span> |
| `/system/merchant` | PCI DSS Req 12.8 | debugInfo="MerchantAgreementProcedure · PCI DSS Req 12.8" |
| `/system/merchant` | PCI DSS Req 7, Req 12.8 | debugInfo="MerchantAgreementProcedure · PCI DSS Req 7 · Req 12.8" |
| `/system/merchant/[merchantId]` | PCI DSS Req 3/7 | <h2 className="text-sm font-semibold text-gray-700">Activity <span className="text-xs font-normal text-gray-400">· aggregates only, no payer PII (PCI  |
| `/system/merchant/[merchantId]` | PCI DSS Req 3/7 | <span className="text-xs font-normal text-gray-400">· masked PAN only, no payer PII (PCI DSS Req 3/7)</span> |
| `/system/merchant/[merchantId]` | PCI DSS Req 7 | <span>Auditor oversight is read-only: you can analyze any payment and open its linked investigation case to review it, but initiating a new case is an |
| `/system/merchant/[merchantId]` | Req 10 | <span className="text-[10px] font-mono text-gray-400">Req 10{auditDerived ? ' · derived from record': ' · append-only log'}</span> |
| `/system/merchant/[merchantId]/activity` | PCI DSS Req 10 | debugInfo="businessProcessEvent (audit) · attribution merchantAgreementReference/actingPartyReference · PCI DSS Req 10" |
| `/system/merchant/[merchantId]/api-keys` | PCI DSS Req 3, Req 8 | debugInfo="credential management · PCI DSS Req 3 (hash only) · Req 8 (unique, revocable credentials)" |
| `/system/merchant/[merchantId]/authorizations` | PCI DSS Req 10 | debugInfo="partyAuthConsent (ConsentGrant) · PCI DSS Req 10 · display-safe" |
| `/system/merchant/[merchantId]/checkout` | Req 3, SAQ A | debugInfo="Payment Order · PCI DSS SAQ A / Req 3 (PAN not handled by the merchant site)" |
| `/system/merchant/[merchantId]/events` | PCI DSS Req 10.7 | debugInfo="BQ:Notification, ADR-038, PCI DSS Req 10.7" |
| `/system/merchant/[merchantId]/links` | PCI DSS Req 3 | debugInfo="Payment Order · PCI DSS Req 3 (PAN captured on the hosted page)" |
| `/system/merchant/[merchantId]/overview` | PCI DSS Req 3 & 7 | debugInfo="BIAN Merchant Activity Analysis · PCI DSS Req 3 & 7 (aggregates only, no payer PII)" |
| `/system/merchant/[merchantId]/payments` | PCI DSS Req 3 & 7 | debugInfo="acquiring view · PCI DSS Req 3 & 7 (masked PAN only, no payer PII)" |
| `/system/merchant/[merchantId]/payments` | PCI DSS Req 3 | Data minimization (PCI DSS Req 3 &amp; 7): only the masked PAN and acquiring details are shown. The payer&apos;s account, email and gateway payload ar |
| `/system/merchant/[merchantId]/payments/[tid]` | PCI DSS Req 3 | PCI DSS Req 3 &amp; 7: Merchant acquiring view: only the masked PAN and card token are displayed. Full PAN, CVV, payer identity, and gateway payload a |
| `/system/merchant/[merchantId]/settings` | PCI DSS Req 12.8 | debugInfo="Merchant Relations · PCI DSS Req 12.8 (TPSP responsibilities)" |
| `/system/merchant/[merchantId]/settings` | PCI DSS Req 12.8 | Know Your Business identity verification performed by the PSP during onboarding (PCI DSS Req 12.8). |
| `/system/merchant/[merchantId]/settings` | PCI Req 12.8 | KybCheck · PCI Req 12.8 |
| `/system/merchant/[merchantId]/settings` | PCI DSS Req 10 | The account and all its data are retained for audit compliance (PCI DSS Req 10). You can request reactivation from your merchant officer. |
| `/system/merchant/[merchantId]/sso` | PCI DSS Req 7 | 'read:transactions': 'Access to transaction data (PCI DSS Req 7)', |
| `/system/merchant/[merchantId]/sso` | PCI DSS Req 10 | { key: 'security_auditor', label: 'Security Auditor', description: 'Read-only audit access (PCI DSS Req 10)' }, |
| `/system/merchant/[merchantId]/webhooks` | PCI DSS Req 12.8 | debugInfo="BQ:Notification, ADR-038, PCI DSS Req 12.8, ISO 20022 pacs.002" |
| `/system/merchant/[merchantId]/webhooks` | PCI DSS Req 12.8 | <p className="font-mono text-gray-400 pt-1">BQ:Notification, ADR-038, PCI DSS Req 12.8, ISO 20022 pacs.002</p> |
| `/system/merchant/review` | PCI DSS Req 7.1 | {debugMode && <div className="text-xs text-gray-400 mt-2">PCI DSS Req 7.1, Least privilege access control</div>} |
| `/system/merchant/review` | PCI DSS Req 7.1, Req 12.8 | PCI DSS Req 7.1 · Req 12.8 |
| `/system/merchant/review` | PCI Req 12.8 | {' '} BQ:Step · PCI Req 12.8 |
| `/system/notifications` | PCI DSS Req 7, Req 10 | debugInfo="ADR-031 · PCI DSS Req 7 (own-data) / Req 10 (traceable)" |
| `/system/payment` | PCI DSS Req 3.2 | {debugMode ? ' (PCI DSS Req 3.2; SAD prohibited).' : '.'} |
| `/system/payment/history` | PCI DSS Req 7.2 | debugInfo="Card Transaction Payment Execution · PCI DSS Req 7.2" |
| `/system/payment/history/[txnId]` | PCI DSS Req 3.3. | <BlockRow label="Card" info="PAN masked to last 4 digits per PCI DSS Req 3.3. The full PAN is never stored after authorisation. Click to manage the ca |
| `/system/payment/history/[txnId]` | PCI DSS Req 3.5 | <BlockRow label="Card token" info="Opaque reference replacing the PAN for downstream processing (tokenisation per PCI DSS Req 3.5). Use this token to  |
| `/system/payment/history/[txnId]` | Req 10, Req 3 | alignment: { bian: 'Card Transaction', pciDss: ['Req 3 (no PAN/CVV at rest)', 'Req 10 (auditable)'] }, |
| `/system/profile` | PCI DSS Req 8.1 | customerAgreementKycCheck?: CustomerAgreementKycCheck; // BQ:Step, SD-53. PCI DSS Req 8.1 |
| `/system/profile` | PCI Req 8.1 | <DebugChip label="PCI Req 8.1" tone="standard" /> |
| `/system/profile` | PCI DSS Req 8, Req 3 | debugInfo="Customer Agreement · PCI DSS Req 8 (identity) · Req 3 (QE at rest)" |
| `/system/profile` | PCI Req 8.1 | <DebugChip label="BQ:Step · KycCheck · PCI Req 8.1" /> |
| `/system/profile` | PCI DSS Req 8 | {debugMode && <DebugChip label="partyEnrolledCredential · CIBA · PCI DSS Req 8" />} |
| `/system/profile/applications` | PCI DSS Req 7 | debugInfo="ConsentGrant · OAuth 2.0 / OIDC · PCI DSS Req 7 (least privilege) · soft-revoke (audit) · self-scoped (sub)" |
| `/system/profile/credentials` | PCI DSS Req 8 | debugInfo="partyEnrolledCredential · WebAuthn/FIDO2 · CIBA · NIST SP 800-63B AAL1 · PCI DSS Req 8" |
| `/system/transactions` | PCI DSS Req 10.2 | debugInfo="Card Transaction · PCI DSS Req 10.2 · QE:none fields decrypt only for L2/auditor" |
| `/system/users` | PCI DSS Req 3/7/12.3 | debugInfo="Customer Agreement / PCI DSS Req 3/7/12.3 · MongoDB Queryable Encryption (no plaintext leaves the app)" |
| `/system/users` | PCI DSS Req 7 | returns a list, gated to L2 investigator / auditor (least-privilege, PCI DSS Req 7). Server |
| `/system/users/[customerId]` | PCI DSS Req 7 | ? `Contact PII (email, phone) is restricted at the L1 access level${debugMode ? ' (PCI DSS Req 7, need-to-know)' : ''}. Available to L2 investigators  |
| `/system/users/[customerId]` | PCI DSS Req 3.2/3.3, Req 10 | info="QE:none fields (encrypted at rest, NOT searchable): residential address and risk notes. Hidden by default; the eye performs an on-demand, epheme |
| `component: AccessDenied.tsx` | PCI DSS Req 7 | debugInfo={resource ? `${RESOURCE_BIAN[resource] ?? resource} · denied: ${resource}:${action} · PCI DSS Req 7 (least privilege)` : undefined} |
| `component: CaseQuestionsPanel.tsx` | PCI Req 10 | <span className="text-[10px] text-gray-400 ml-auto">answers are immutable (PCI Req 10)</span> |
| `component: EncryptedKycSearch.tsx` | PCI DSS Req 7 | or the customer, and cannot browse the customer base by attribute (least-privilege, PCI DSS Req 7). |
| `component: IntegrityPanel.tsx` | PCI DSS Req 10 | {debugMode && <p className="mt-2 text-[10px] font-mono text-gray-400">control-record integrity · PCI DSS Req 10 · read-only</p>} |
| `component: IntegrityPanel.tsx` | PCI DSS Req 10 | {debugMode && <p className="mt-3 text-[10px] font-mono text-gray-400">control-record integrity · PCI DSS Req 10 · read-only</p>} |
| `component: SavedCardsPanel.tsx` | PCI Req 3.4 | <DebugChip label="paymentCardManagement · PCI Req 3.4" /> |
| `component: SavedCardsPanel.tsx` | PCI DSS Req 3.2 / 3.4 | {debugMode ? ' (PCI DSS Req 3.2 / 3.4; token is a surrogate, expiry is QE:none).' : '.'} |
| `config: acl.ts` | PCI Req 10 | auditEvents: 'ADR-025 · PCI Req 10', |
| `config: capabilities.ts` | PCI DSS Req 3.3 | description: 'Card authorization request/response (no CVV passed; PCI DSS Req 3.3).', |
| `config: roleGuide.ts` | Req 12, Req 3, Req 7 | pci: ['Req 3', 'Req 7', 'Req 12'], |
| `config: roleGuide.ts` | Req 10, Req 3, Req 7 | pci: ['Req 3', 'Req 7', 'Req 10'], |
| `config: roleGuide.ts` | Req 10, Req 3, Req 7, Req 8 | pci: ['Req 3', 'Req 7', 'Req 8', 'Req 10'], |
| `config: roleGuide.ts` | Req 10, Req 12 | pci: ['Req 10', 'Req 12'], |
| `config: roleGuide.ts` | PCI Req 7 | 'KYB decision (approve/reject) authority; data correction of KYB records/owners is shared with the Operations Officer, who cannot make the decision (S |
| `config: roleGuide.ts` | Req 12, Req 7 | pci: ['Req 7', 'Req 12'], |
| `config: roleGuide.ts` | PCI DSS Req 7 | 'Does not manage providers or modules; that is the manager role (separation of duties, PCI DSS Req 7).', |
| `config: roleGuide.ts` | Req 10, Req 3.2/3.3, Req 7 | pci: ['Req 3.2/3.3', 'Req 7', 'Req 10'], |
| `config: roleGuide.ts` | Req 10, Req 12, Req 8 | pci: ['Req 8', 'Req 10', 'Req 12'], |
| `psp/frontend/src/app/system/admin/_components/IntegrationCategoryPage.tsx` | PCI DSS Req 12.8.1 | debugInfo={'PCI DSS Req 12.8.1'} |
| `psp/frontend/src/app/system/admin/integrations/[id]/_shared.tsx` | Req. | <th className="px-3 py-2 font-medium w-14 text-center">Req.</th> |
| `psp/frontend/src/app/system/admin/modules/_components/CardsAdminPanel.tsx` | PCI DSS Req 3.2 | <p className="text-xs text-gray-400">CVV and PIN are never accepted or stored (PCI DSS Req 3.2). PAN is display-safe (masked) only.</p> |
| `psp/frontend/src/app/system/admin/providers/vendors/[id]/_shared.tsx` | Req. | <th className="px-3 py-2 font-medium w-14 text-center">Req.</th> |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.6 | <><Em>Req 3.6:</Em> How the CMK is managed in AWS KMS, DEK rotation schedules, and the KMS key policy.</>, |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 7 | <><Em>Req 7:</Em> Whether access to the decryption capability is role-restricted.</>, |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 10 | <><Em>Req 10:</Em> Whether every field-access event is audited.</>, |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.6 | tags: ['QSA', 'AOC', 'CMK', 'DEK', 'KMS', 'key management', 'Req 3.6'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 1 | ['Req 1–2 (Network security)', 'IP Access Lists, VPC Peering, Private Endpoints, tenant isolation between clusters'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.4 | ['Req 3.4 (CHD unreadable at rest)', 'AES-256 encryption at rest on all storage volumes and backup media'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 4 | ['Req 4 (Encryption in transit)', 'TLS 1.2+ enforced on all client connections; cannot be disabled'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 7 | ['Req 7–8 (Access control & auth)', 'Atlas RBAC, MFA on Atlas console, LDAP integration, privileged access management'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 10 | ['Req 10 (Audit logging)', 'Atlas Audit Log infrastructure, maintained and secured by MongoDB'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 11 | ['Req 11–12 (Vuln. management)', 'MongoDB patching program, security scanning, and information security policies'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.4 | <><Em>Req 3.4:</Em> CHD field is encrypted before the BSON document leaves the application server. MongoDB never receives plaintext, so it cannot appe |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.6 | <><Em>Req 3.6:</Em> The CMK is held exclusively by the customer in AWS KMS. Revoking the CMK immediately renders all QE-encrypted data unreadable from |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 7 | <><Em>Req 7:</Em> A user with full Atlas admin credentials querying without the QE client receives only opaque binary ciphertext. The restriction is < |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 10 | <><Em>Req 10:</Em> Every decryption event occurs in the application layer, where it can be logged with full business context: user, role, fraud case,  |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 10, Req 3.4, Req 3.6, Req 7 | tags: ['QE', 'PCI DSS', 'Req 3.4', 'Req 3.6', 'Req 7', 'Req 10', 'threat model', 'certification'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.4 | tags: ['Req 3.4', 'PAN', 'tokenization', 'non-storage', 'maskedPan', 'Visa Token Service'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.1 | [<Code>cardholderConsentTimestamp</Code>, 'Required: Req 3.1 + network rules'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.7 | [<><Code>mandateStatus</Code> (active / cancelled / expired)</>, 'Required for Req 3.7 purge logic'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.1 | <><Em>Explicit cardholder consent (Req 3.1 + network rules):</Em> The save-card step must present an explicit consent checkbox and record the <Code>ca |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 7 | <><Em>Scope-limited access to the charge trigger (Req 7):</Em> Only the payment processing service should be able to initiate a new charge. Fraud inve |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.7 | <><Em>Periodic purge of unused stored cards (Req 3.7):</Em> Stored card data must be deleted when the customer cancels the mandate, when the card expi |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.3, Req 3.7 | tags: ['recurring payment', 'save card', 'v4', 'consent', 'mandate', 'CVV', 'Req 3.3', 'Req 3.7'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | PCI DSS Req 7.1 | <P>This is one of the most important design decisions in the v2 architecture. The short answer is: <Em>a job title is not a justification</Em>. PCI DS |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 7.1 | ['Req 7.1: Restrict access by business need', 'The token proves the business need: a specific case, at a specific time, approved by the L2 investigato |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 7.2 | ['Req 7.2: Access control based on need to know', 'Access requires role + valid token + case match. This is two-factor access control on sensitive dat |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 10.2 | ['Req 10.2: Audit trail for access to CHD', 'Every sensitive field access writes a field_accessed audit event with: timestamp, role, caseId, and the e |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 10.3 | ['Req 10.3: Protect audit logs from destruction', 'Audit events are written to fraudDiagnosisCaseEvents with no delete API exposed.'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 10, Req 7 | tags: ['RBAC', 'escalation token', 'Req 7', 'Req 10', 'need-to-know', 'audit', 'level2_investigator'], |
| `psp/frontend/src/app/system/help/_QASection.tsx` | PCI DSS Req 3.2 | <P>The CVV is Sensitive Authentication Data: PCI DSS Req 3.2 forbids storing it after authorization, in cleartext or ciphertext. The built-in issuer t |
| `psp/frontend/src/app/system/help/_QASection.tsx` | Req 3.2 | tags: ['CVV', 'SAD', 'Req 3.2', 'HMAC', 'CVK', 'envelope encryption', 'derivation', 'cvvMode'], |
| `merchant/src/app/help/page.tsx` | SAQ A | in <Chip tone="accent">PCI DSS SAQ A</Chip> scope. |
| `merchant/src/app/layout.tsx` | SAQ A | Espresso Works Ltd, external merchant demo. No card data handled here (PCI DSS SAQ A). |
