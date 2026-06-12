'use client';
import React, { useState, useEffect } from 'react';
import {
  Download, Check, CheckSquare, ChevronDown, ChevronUp,
  ExternalLink, Shield, Database, Lock, Eye, FileText,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckItem { id: string; text: string; detail?: string; newV4?: boolean; }

interface PciRequirement {
  num: string; title: string; goal: string; goalNum: string;
  summary: string; items: CheckItem[]; frequency: string;
  reference: string; mongodbFeatures: string[];
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const REQUIREMENTS: PciRequirement[] = [
  {
    num: '1', title: 'Install and Maintain Network Security Controls',
    goal: 'Build and Maintain a Secure Network and Systems', goalNum: '1',
    summary: 'Implement firewalls, routers, SDN, WAFs, and cloud security groups to control traffic into and out of the Cardholder Data Environment (CDE). Deny all traffic except what is explicitly required.',
    frequency: 'NSC configurations reviewed every 6 months; topology diagrams kept current.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=46',
    mongodbFeatures: ['Private Endpoints (AWS/Azure/GCP)', 'VPC/VNet Peering', 'IP Access List', 'Network Peering'],
    items: [
      { id: '1.1', text: 'Document and publish a network security control (NSC) policy and assign roles and responsibilities', detail: 'Req 1.1.1, 1.1.2. Must cover all NSC types: firewalls, routers, cloud security groups, WAFs. Roles must be named.' },
      { id: '1.2', text: 'Maintain current network topology diagrams showing all CDE connections and data-flow diagrams', detail: 'Req 1.2.3, 1.2.4. Update whenever infrastructure changes.' },
      { id: '1.3', text: 'Configure all NSCs with deny-all default; allow only explicitly justified services, protocols, and ports', detail: 'Req 1.2.1, 1.3.1, 1.3.2. Document business justification for each allowed rule (Req 1.2.5, 1.2.6).' },
      { id: '1.4', text: 'Install NSCs between all wireless networks and the CDE with deny-all default', detail: 'Req 1.3.3. Required even if wireless is considered internal.' },
      { id: '1.5', text: 'Implement anti-spoofing measures to detect and block forged source IP addresses', detail: 'Req 1.4.3. Prevents source IP spoofing attacks targeting the CDE.' },
      { id: '1.6', text: 'Ensure CHD storage systems are not directly accessible from untrusted networks', detail: 'Req 1.4.4. Databases, file servers, and any storage holding PAN must sit behind NSCs.' },
      { id: '1.7', text: 'Restrict disclosure of internal IP addresses and routing information to external parties', detail: 'Req 1.4.5. Prevents network reconnaissance.' },
      { id: '1.8', text: 'Review NSC configurations at least every six months and correct identified weaknesses', detail: 'Req 1.2.7. Document review results and any corrective actions.' },
      { id: '1.9', text: 'Apply security controls to all employee devices connecting to both untrusted networks and the CDE', detail: 'Req 1.5.1. Laptops and mobile devices represent a common CDE perimeter gap.' },
    ],
  },
  {
    num: '2', title: 'Apply Secure Configurations to All System Components',
    goal: 'Build and Maintain a Secure Network and Systems', goalNum: '1',
    summary: 'Establish and maintain secure configuration baselines for all system components. Eliminate vendor defaults, disable unnecessary services, and encrypt all administrative access.',
    frequency: 'Configuration standards reviewed when new threats emerge; wireless defaults changed at installation.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=68',
    mongodbFeatures: ['TLS Mandatory (Atlas)', 'Encrypted Storage', 'Atlas Security Advisor', 'IP Access List defaults'],
    items: [
      { id: '2.1', text: 'Develop, implement, and maintain configuration standards for all system components', detail: 'Req 2.2.1. Standards must align with CIS Benchmarks, NIST, or vendor hardening guides.' },
      { id: '2.2', text: 'Change or disable all vendor-supplied default accounts and passwords before installation', detail: 'Req 2.2.2. Default credentials are the #1 exploitation vector. Remove unused default accounts entirely.' },
      { id: '2.3', text: 'Separate primary functions requiring different security levels onto separate system components', detail: 'Req 2.2.3. Web servers and database servers must not share the same host.' },
      { id: '2.4', text: 'Enable only necessary functions, components, ports, protocols, and services', detail: 'Req 2.2.4. Disable all unused features on operating systems, databases, and applications.' },
      { id: '2.5', text: 'Encrypt all non-console administrative access (SSH, RDP, web-based management) with strong cryptography', detail: 'Req 2.2.7. Clear-text admin protocols (Telnet, HTTP, rlogin) are prohibited in the CDE.' },
      { id: '2.6', text: 'Change all wireless vendor defaults at installation: SSIDs, passwords, SNMP community strings, and encryption keys', detail: 'Req 2.3.1, 2.3.2. Default wireless settings are publicly known and trivially exploitable.' },
    ],
  },
  {
    num: '3', title: 'Protect Stored Account Data',
    goal: 'Protect Account Data', goalNum: '2',
    summary: 'Minimize storage of cardholder data, never store Sensitive Authentication Data (SAD) after authorization, and render stored PANs unreadable using strong cryptography. Implement full key management lifecycle controls.',
    frequency: 'Data retention policies enforced continuously; crypto architecture reviewed annually (Req 3.6.1.1).',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=88',
    mongodbFeatures: ['Queryable Encryption (QE)', 'Client-Side Field Level Encryption (CSFLE)', 'Customer-Managed Keys (CMK)', 'AWS KMS / Azure Key Vault / GCP KMS / KMIP'],
    items: [
      { id: '3.1', text: 'Define and enforce a data retention and disposal policy; store account data only as long as necessary', detail: 'Req 3.1.1, 3.2.1. Automated purge mechanisms required. Every stored PAN needs a documented business justification.' },
      { id: '3.2', text: 'Never store Sensitive Authentication Data (SAD) after authorization is complete', detail: 'Req 3.3.1. SAD includes full track data, CAV2/CVC2/CVV2/CID codes, and PINs. No exceptions for non-issuers.' },
      { id: '3.3', text: 'Render PAN unreadable using AES-256 encryption, truncation, HMAC keyed hashing, or index tokens with separate vault', detail: 'Req 3.4.1, 3.5.1.1. Plain SHA-256 hashing is no longer sufficient (v4.0); must use keyed cryptographic hashes (HMAC).', newV4: true },
      { id: '3.4', text: 'Implement technical controls to prevent PAN copy/paste or relocation via remote access tools', detail: 'Req 3.4.2. Restricts clipboard operations, screen capture, and file transfer tools that could exfiltrate PAN.', newV4: true },
      { id: '3.5', text: 'Implement full key management lifecycle: generation, distribution, storage, retirement, replacement, destruction', detail: 'Req 3.6.1, 3.7.1 to 3.7.9. Includes split knowledge, dual control, regular key rotation, and secure key ceremony documentation.' },
      { id: '3.6', text: 'Document your cryptographic architecture: all algorithms, protocols, keys, key strengths, and key custodians', detail: 'Req 3.6.1.1. Required for service providers; strongly recommended for all entities. Review at least annually.', newV4: true },
      { id: '3.7', text: 'Use only strong cryptography: RSA 2048+, AES-128/256, ECDSA P-256+, and TLS 1.2+; review cipher suite list annually', detail: 'Req 3.5.1, 12.3.3. Explicit inventory of all cryptographic algorithms in use, reviewed annually for deprecation.' },
    ],
  },
  {
    num: '4', title: 'Protect Cardholder Data with Strong Cryptography During Transmission',
    goal: 'Protect Account Data', goalNum: '2',
    summary: 'Use strong cryptography (TLS 1.2 or higher) to protect all cardholder data transmitted over open, public networks. Maintain an inventory of all trusted keys and certificates.',
    frequency: 'Certificate inventory reviewed continuously; expired certificates detected automatically.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=114',
    mongodbFeatures: ['TLS 1.2/1.3 enforced by Atlas (cannot be disabled)', 'Certificate Management', 'Driver TLS verification'],
    items: [
      { id: '4.1', text: 'Use strong cryptography (TLS 1.2+) for all PAN transmissions over open, public networks', detail: 'Req 4.2.1. Open networks include the Internet, Wi-Fi, Bluetooth, GPRS, and satellite. PAN must never travel in cleartext.', newV4: true },
      { id: '4.2', text: 'Maintain an inventory of all trusted keys and certificates used to protect PAN in transit', detail: 'Req 4.2.1.1. Inventory must include certificate expiry dates, issuing CA, and renewal process.', newV4: true },
      { id: '4.3', text: 'Accept only valid, non-expired, non-revoked certificates from trusted certificate authorities', detail: 'Req 4.2.1. Implement certificate pinning or CA validation on all CHD-handling connections.' },
      { id: '4.4', text: 'Never transmit PANs via unprotected end-user messaging technologies', detail: 'Req 4.2.2. Covers SMS, email, instant messaging, and chat platforms unless end-to-end encrypted.' },
      { id: '4.5', text: 'Document a cardholder data transmission policy with assigned roles and responsibilities', detail: 'Req 4.1.1, 4.1.2. Policy must explicitly prohibit clear-text PAN transmission.' },
    ],
  },
  {
    num: '5', title: 'Protect All Systems and Networks from Malicious Software',
    goal: 'Maintain a Vulnerability Management Program', goalNum: '3',
    summary: 'Deploy and maintain anti-malware solutions on all applicable system components. Implement email security controls (DMARC, SPF, DKIM) to protect against phishing attacks.',
    frequency: 'Signatures updated automatically; scans performed in real-time or via scheduled TRA-defined frequency.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=128',
    mongodbFeatures: ['Atlas managed infrastructure (MongoDB patches underlying OS)', 'Atlas Security Advisor'],
    items: [
      { id: '5.1', text: 'Deploy anti-malware solutions on all system components; evaluate systems not commonly at risk periodically', detail: 'Req 5.2.1, 5.2.3. Covers all media types including removable storage (Req 5.3.3).', newV4: true },
      { id: '5.2', text: 'Ensure anti-malware detects viruses, worms, Trojans, spyware, rootkits, ransomware, and adware', detail: 'Req 5.2.2. Solution must actively detect and remove all listed malware types.' },
      { id: '5.3', text: 'Enable automatic signature/definition updates and real-time or continuous behavioral scanning', detail: 'Req 5.3.1, 5.3.2. Scheduled-only scanning requires TRA-defined frequency.' },
      { id: '5.4', text: 'Enable and retain anti-malware audit logs per the audit log retention policy (Req 10)', detail: 'Req 5.3.4. Malware detection events must be logged and retained for 12 months.' },
      { id: '5.5', text: 'Prevent users from disabling or altering anti-malware without documented management authorization per-case', detail: 'Req 5.3.5. Anti-malware must not have a user-accessible disable switch.' },
      { id: '5.6', text: 'Implement DMARC, SPF, and DKIM to protect personnel from phishing attacks targeting the CDE', detail: 'Req 5.4.1. DMARC policy at minimum p=quarantine, SPF with -all, and DKIM signing are all required.', newV4: true },
    ],
  },
  {
    num: '6', title: 'Develop and Maintain Secure Systems and Software',
    goal: 'Maintain a Vulnerability Management Program', goalNum: '3',
    summary: 'Follow a secure SDLC, train developers annually, apply patches within defined timeframes, maintain a software inventory (SBOM), and deploy WAF protection for public-facing web applications.',
    frequency: 'Critical patches within 1 month; all other patches within 6 months; developer security training annually.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=143',
    mongodbFeatures: ['Atlas automated minor-version patching', 'MongoDB Security Advisories', 'Atlas Security Advisor'],
    items: [
      { id: '6.1', text: 'Implement a secure SDLC; train all developers in software security at least annually', detail: 'Req 6.2.1, 6.2.2. Training must cover current threats and OWASP Top 10. Track completion with records.' },
      { id: '6.2', text: 'Review all custom and bespoke software for security vulnerabilities before every production release', detail: 'Req 6.2.3, 6.2.3.1. Automated SAST/DAST tools acceptable; manual code review required for payment-critical paths.' },
      { id: '6.3', text: 'Prevent/mitigate OWASP Top 10 vulnerabilities: injection, XSS, broken auth, IDOR, and CSRF in all custom code', detail: 'Req 6.2.4. Explicitly includes SQL injection, NoSQL injection, OS injection, and LDAP injection.' },
      { id: '6.4', text: 'Apply critical security patches within 1 month of release; apply all other patches within 6 months', detail: 'Req 6.3.3. Critical refers to CVSS v3.1 scores 9.0+ or those exploiting CHD systems.' },
      { id: '6.5', text: 'Maintain a software inventory (SBOM-equivalent) for all bespoke and custom software including third-party libraries', detail: 'Req 6.3.2. Inventory must include component name, version, and supplier.', newV4: true },
      { id: '6.6', text: 'Deploy and maintain a WAF for all public-facing web applications that actively blocks web attacks', detail: 'Req 6.4.1, 6.4.2. Automated WAF in blocking mode required. Rule sets must be updated continuously.', newV4: true },
      { id: '6.7', text: 'For payment pages: inventory all scripts, authorize each one, and verify integrity (SRI hashes or CSP)', detail: 'Req 6.4.3. Addresses Magecart/JS skimming attacks. Each script must be authorized, integrity-verified, and documented.', newV4: true },
      { id: '6.8', text: 'Separate development, test, and production environments; prohibit live/production data in test environments', detail: 'Req 6.5.1 to 6.5.6. Test PANs must be synthetic; production data must never be used in test/dev environments.' },
    ],
  },
  {
    num: '7', title: 'Restrict Access to System Components and Cardholder Data by Business Need to Know',
    goal: 'Implement Strong Access Control Measures', goalNum: '4',
    summary: 'Implement a least-privilege, need-to-know access control model with deny-all default. Review all user and system account access at least every six months.',
    frequency: 'User accounts reviewed every 6 months; system/application accounts reviewed per TRA-defined frequency.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=175',
    mongodbFeatures: ['Role-Based Access Control (RBAC)', 'Custom Database Roles', 'Built-in Roles (read/readWrite/dbAdmin)', 'Atlas RBAC for operations'],
    items: [
      { id: '7.1', text: 'Implement a least-privilege, need-to-know access control model with deny-all as the default', detail: 'Req 7.2.1. Every access grant must have a documented business justification.' },
      { id: '7.2', text: 'Assign access aligned strictly with job classification and function; require formal approval for all access grants', detail: 'Req 7.2.2, 7.2.3. Requests must be approved by authorized management in writing before provisioning.' },
      { id: '7.3', text: 'Review all user accounts and associated access privileges at least every six months', detail: 'Req 7.2.4. Accounts that no longer require access must be disabled promptly.', newV4: true },
      { id: '7.4', text: 'Formally manage and periodically review all application and system account access privileges', detail: 'Req 7.2.5, 7.2.5.1. Service accounts, application accounts, and API keys must be inventoried.', newV4: true },
      { id: '7.5', text: 'Restrict all cardholder data repository queries to programmatic methods only; prohibit direct query tool access', detail: 'Req 7.2.6. No analyst or DBA should run ad-hoc queries against CHD tables outside approved programmatic interfaces.' },
      { id: '7.6', text: 'Deploy an access control system enforcing all access assignments with default set to "deny all"', detail: 'Req 7.3.1 to 7.3.3. IAM, LDAP, PAM, or database RBAC must enforce all access decisions.' },
    ],
  },
  {
    num: '8', title: 'Identify Users and Authenticate Access to System Components',
    goal: 'Implement Strong Access Control Measures', goalNum: '4',
    summary: 'Assign unique IDs to all users, enforce strong password/passphrase policies, implement MFA for ALL access into the CDE, and prohibit shared or hard-coded credentials.',
    frequency: 'Inactive accounts disabled within 90 days; MFA cannot be bypassed.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=193',
    mongodbFeatures: ['Atlas MFA', 'LDAP/Active Directory Integration', 'x.509 Certificate Auth', 'SCRAM-SHA-256', 'OIDC / Workforce Identity Federation'],
    items: [
      { id: '8.1', text: 'Assign a unique ID to every user before granting access to any system component or cardholder data', detail: 'Req 8.2.1. Shared accounts and generic IDs are prohibited except in documented exception cases.' },
      { id: '8.2', text: 'Manage the full user ID lifecycle: add, modify, suspend, and delete accounts through a formal identity management process', detail: 'Req 8.2.4, 8.2.5. Terminated users must have access revoked immediately on termination day.' },
      { id: '8.3', text: 'Disable inactive user accounts within 90 days of inactivity', detail: 'Req 8.2.6. Set automated account expiry in your IAM system.' },
      { id: '8.4', text: 'Lock accounts after a maximum of 10 consecutive failed authentication attempts', detail: 'Req 8.3.4. Lockout duration must be at least 30 minutes or until an administrator resets the account.' },
      { id: '8.5', text: 'Enforce passwords/passphrases of at least 12 characters containing both numeric and alphabetic characters', detail: 'Req 8.3.6. If the system cannot support 12 characters, 8-character minimum is permitted as a temporary compensating control.', newV4: true },
      { id: '8.6', text: 'Implement MFA for ALL access into the CDE; every user, every role, every location, every method', detail: 'Req 8.4.2. One of the most impactful changes in v4.0. MFA is no longer limited to admin access.', newV4: true },
      { id: '8.7', text: 'Implement MFA for all remote network access originating from outside the entity\'s network that could impact the CDE', detail: 'Req 8.4.3. VPN, remote desktop, SSH, and jump hosts all require MFA from outside the network perimeter.' },
      { id: '8.8', text: 'Ensure MFA implementation is replay-proof and cannot be bypassed by any user including administrators', detail: 'Req 8.5.1. MFA bypass mechanisms must be formally controlled and audited.', newV4: true },
      { id: '8.9', text: 'Prohibit hard-coded passwords in scripts, configuration files, and source code', detail: 'Req 8.6.2. Use secrets management solutions (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault).', newV4: true },
      { id: '8.10', text: 'Re-authenticate idle sessions after 15 minutes of inactivity', detail: 'Req 8.2.8. Applies to all CDE-facing applications, admin consoles, and database sessions.' },
    ],
  },
  {
    num: '9', title: 'Restrict Physical Access to Cardholder Data',
    goal: 'Implement Strong Access Control Measures', goalNum: '4',
    summary: 'Implement physical access controls for the CDE and sensitive areas, maintain visitor logs, manage physical media securely, and protect point-of-interaction (POI) devices from tampering.',
    frequency: 'Visitor logs retained minimum 3 months; media inventory at least annually.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=220',
    mongodbFeatures: ['Atlas hosted in PCI-compliant data centers (SOC 2 / ISO 27001 certified)', 'Atlas physical security inherited (shared responsibility model)'],
    items: [
      { id: '9.1', text: 'Implement appropriate physical entry controls to restrict access to the CDE and sensitive areas', detail: 'Req 9.2.1. Includes badge readers, biometric access, locked server rooms, and mantrap entryways.' },
      { id: '9.2', text: 'Monitor sensitive areas with video surveillance or equivalent physical access control mechanisms', detail: 'Req 9.2.2. Footage must be retained per local regulations (minimum 3 months).' },
      { id: '9.3', text: 'Implement a visitor management process: issue visitor badges, escort visitors, and maintain a visitor log', detail: 'Req 9.3.2 to 9.3.4. Log must record date/time, full name, organization, and employee granting access.' },
      { id: '9.4', text: 'Classify all media containing cardholder data by sensitivity level; approve and log all media movements outside the facility', detail: 'Req 9.4.2 to 9.4.4. Includes backup tapes, hard drives, USB drives, and printed reports containing PAN.' },
      { id: '9.5', text: 'Destroy all hard-copy materials containing PAN when no longer needed; render electronic media with CHD unrecoverable', detail: 'Req 9.4.6, 9.4.7. Cross-cut shredding for paper; NIST SP 800-88 cryptographic erasure or physical destruction for digital media.' },
      { id: '9.6', text: 'Maintain an inventory of all POI devices and inspect them periodically for tampering', detail: 'Req 9.5.1 to 9.5.1.2. Visual inspection frequency must be justified via TRA.', newV4: true },
      { id: '9.7', text: 'Train all POI-handling personnel to identify tampering, unauthorized substitution, and social engineering attempts', detail: 'Req 9.5.1.3. Personnel must know what to look for and who to report to.' },
    ],
  },
  {
    num: '10', title: 'Log and Monitor All Access to System Components and Cardholder Data',
    goal: 'Regularly Monitor and Test Networks', goalNum: '5',
    summary: 'Enable comprehensive audit logging for all CDE components, protect logs from tampering, implement automated log review (SIEM), and retain logs for 12 months with 3 months immediately accessible.',
    frequency: 'Security logs reviewed daily via automated mechanisms; logs retained 12 months (3 months online); FIM comparisons weekly.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=251',
    mongodbFeatures: ['MongoDB Atlas Audit Logging', 'Atlas Log Integration (Datadog, Splunk, PagerDuty, Sumo Logic)', 'Change Streams', 'Atlas Alerts', 'SIEM forwarding'],
    items: [
      { id: '10.1', text: 'Enable audit logging on all CDE systems: all user access to CHD, admin actions, invalid login attempts, and access mechanism changes', detail: 'Req 10.2.1, 10.2.1.1. Log entries must include user ID, event type, date/time, success/failure, originating system, and affected resource.' },
      { id: '10.2', text: 'Protect audit logs from unauthorized modification and deletion; changes must generate alerts', detail: 'Req 10.2.2, 10.3.1. Logs must be write-once or append-only where possible. Implement FIM on log files.' },
      { id: '10.3', text: 'Promptly back up audit logs to a centralized log server or other media that is difficult to alter', detail: 'Req 10.3.3. Central SIEM or syslog server with restricted write access.' },
      { id: '10.4', text: 'Implement automated mechanisms (SIEM) to review security logs from all CDE systems at least daily', detail: 'Req 10.4.1, 10.4.1.1. Manual log review is no longer acceptable for security-critical logs.', newV4: true },
      { id: '10.5', text: 'Retain audit logs for at least 12 months with the most recent 3 months immediately available for analysis', detail: 'Req 10.5.1. Logs older than 3 months may be in compressed/archived storage; document the retrieval SLA.' },
      { id: '10.6', text: 'Synchronize all CDE system clocks from a trusted, industry-accepted time source', detail: 'Req 10.6.1 to 10.6.3. NTP from reliable sources; synchronization settings must be protected from unauthorized modification.' },
      { id: '10.7', text: 'Detect, alert on, and address promptly any failures of critical security controls', detail: 'Req 10.7.2, 10.7.3. Critical controls include NSCs, IDS/IPS, FIM, anti-malware, and audit logging.', newV4: true },
    ],
  },
  {
    num: '11', title: 'Test Security of Systems and Networks Regularly',
    goal: 'Regularly Monitor and Test Networks', goalNum: '5',
    summary: 'Conduct quarterly internal and external vulnerability scans, annual penetration tests, deploy IDS/IPS, implement file integrity monitoring (FIM), and detect changes to payment pages.',
    frequency: 'Internal scans quarterly; external ASV scans quarterly; penetration tests annually; FIM comparisons weekly.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=292',
    mongodbFeatures: ['Atlas Security Advisor (configuration best practices)', 'MongoDB automated patching', 'Atlas vulnerability notifications'],
    items: [
      { id: '11.1', text: 'Perform internal vulnerability scans at least every three months using authenticated scanning', detail: 'Req 11.3.1, 11.3.1.2. Rescan until all high-risk and critical findings are resolved.', newV4: true },
      { id: '11.2', text: 'Perform external vulnerability scans via an Approved Scanning Vendor (ASV) at least every three months', detail: 'Req 11.3.2. Only PCI SSC-approved ASVs qualify. Directory: https://www.pcisecuritystandards.org/assessors_and_solutions/approved_scanning_vendors' },
      { id: '11.3', text: 'Conduct internal and external penetration testing at least annually and after any significant infrastructure or application changes', detail: 'Req 11.4.1, 11.4.2. Testing must follow NIST SP 800-115, PTES, or OWASP methodology.' },
      { id: '11.4', text: 'If using network segmentation to isolate the CDE, test segmentation effectiveness at least annually (service providers: every 6 months)', detail: 'Req 11.4.3. Any successful breach of the isolation invalidates the scope reduction.' },
      { id: '11.5', text: 'Deploy IDS/IPS to detect and/or prevent intrusions into the CDE; update signatures regularly', detail: 'Req 11.4.5. Alerts must route to the security team with defined response procedures.' },
      { id: '11.6', text: 'Implement file integrity monitoring (FIM) on critical system files; review alerts and perform comparisons at least weekly', detail: 'Req 11.5.2. FIM must cover OS binaries, configuration files, audit logs, and application code.' },
      { id: '11.7', text: 'Deploy change-and-tamper detection for payment page HTTP headers and script contents; evaluate at least weekly', detail: 'Req 11.6.1. Addresses Magecart/JS skimming attacks targeting payment pages.', newV4: true },
      { id: '11.8', text: 'Manage wireless access point detection quarterly; alert on unauthorized APs within 24 hours', detail: 'Req 11.2.1. Use wireless intrusion detection, automated scanning, or physical sweeps.' },
    ],
  },
  {
    num: '12', title: 'Support Information Security with Organizational Policies and Programs',
    goal: 'Maintain an Information Security Policy', goalNum: '6',
    summary: 'Establish a comprehensive information security policy reviewed annually, appoint a CISO, conduct regular Targeted Risk Analyses (TRA), train all personnel, manage third-party providers, and maintain a tested incident response plan.',
    frequency: 'Policy reviewed annually; security awareness training annually; incident response plan tested annually.',
    reference: 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf#page=338',
    mongodbFeatures: ['MongoDB Trust Center (PCI, SOC 2, ISO certs)', 'Shared Responsibility Model documentation', 'TOSM (Trust and Operational Security Manual)', 'MongoDB DPA'],
    items: [
      { id: '12.1', text: 'Publish and maintain an information security policy; review and update it at least annually', detail: 'Req 12.1.1, 12.1.2. Policy must be disseminated to all relevant personnel. Acknowledge receipt in writing annually.' },
      { id: '12.2', text: 'Formally assign information security responsibility to a CISO or equivalent security-knowledgeable executive', detail: 'Req 12.1.4. The responsible person must have both authority and budget to enforce security requirements.' },
      { id: '12.3', text: 'Conduct a Targeted Risk Analysis (TRA) for each PCI DSS requirement that specifies a "periodic" activity without a defined frequency', detail: 'Req 12.3.1. Nine requirements need TRA-defined frequencies. Must be reviewed annually.', newV4: true },
      { id: '12.4', text: 'Review cryptographic cipher suites and protocols in use at least annually; plan removal of deprecated algorithms', detail: 'Req 12.3.3. Check against NIST SP 800-131A for deprecated algorithms.', newV4: true },
      { id: '12.5', text: 'Document and confirm the PCI DSS scope at least annually and upon significant change; obtain written executive sign-off', detail: 'Req 12.5.2. Scope creep is a common audit finding. Service providers must confirm scope every 6 months.', newV4: true },
      { id: '12.6', text: 'Conduct a security awareness training program for all personnel upon hire and at least annually; include phishing and social engineering', detail: 'Req 12.6.1, 12.6.3. Training must cover threats relevant to each role and recognition of social engineering attempts.', newV4: true },
      { id: '12.7', text: 'Screen all personnel with CDE access prior to hire; conduct background checks appropriate to their level of access', detail: 'Req 12.7.1. At minimum: identity verification, criminal record check, and employment history verification.' },
      { id: '12.8', text: 'Maintain a list of all third-party service providers (TPSPs) with written agreements documenting PCI DSS responsibility allocation', detail: 'Req 12.8.1 to 12.8.5. Includes cloud providers, payment processors, hosting companies, and managed service providers.' },
      { id: '12.9', text: 'Maintain and test an incident response plan annually; ensure 24/7 availability of incident response contacts', detail: 'Req 12.10.1 to 12.10.4. Test via tabletop exercises or simulations. Document lessons learned.' },
      { id: '12.10', text: 'Define incident response procedures for PAN found in unexpected locations; include response, notification, and isolation steps', detail: 'Req 12.10.7. Automated tools to scan for PAN in unexpected systems recommended.', newV4: true },
    ],
  },
];

const MONGODB_MAPPING = [
  { reqs: '1 & 2', area: 'Network Isolation and Secure Configuration',
    features: ['Private Endpoints (AWS PrivateLink / Azure Private Link / GCP PSC)', 'VPC/VNet Peering', 'IP Access List (allowlisting)', 'TLS 1.2/1.3 mandatory; cannot be disabled in Atlas'],
    description: 'Atlas Private Endpoints ensure all traffic between your application and MongoDB stays on the cloud provider backbone, never traversing the public internet. Combined with IP allowlisting, this creates a network-level CDE boundary with no direct internet exposure to the database layer.',
    docs: 'https://www.mongodb.com/docs/atlas/security-private-endpoint/' },
  { reqs: '3', area: 'Protect Stored Account Data (PAN/SAD)',
    features: ['Queryable Encryption (QE); equality search on encrypted fields', 'Client-Side Field Level Encryption (CSFLE)', 'Customer-Managed Keys (CMK) via AWS KMS, Azure Key Vault, GCP KMS, or KMIP', 'Envelope encryption; data keys encrypted by master keys you control'],
    description: 'MongoDB Queryable Encryption is the only commercially available solution enabling equality searches on encrypted fields without the database server ever seeing plaintext PAN. Data is encrypted by the application driver using AEAD (AES-256-CBC + HMAC-SHA512) before reaching the database.',
    docs: 'https://www.mongodb.com/docs/manual/core/queryable-encryption/' },
  { reqs: '4', area: 'Protect Data in Transit',
    features: ['TLS 1.2/1.3 enforced for all Atlas connections', 'Certificate management via Atlas', 'Driver-level TLS certificate validation', 'Minimum TLS version configurable (TLS 1.2 floor)'],
    description: 'Atlas enforces TLS encryption on all connections; it cannot be downgraded or disabled. All MongoDB drivers verify server certificates by default, eliminating man-in-the-middle attacks between your application and the database.',
    docs: 'https://www.mongodb.com/docs/atlas/security-ssl/' },
  { reqs: '7 & 8', area: 'Access Control and Authentication',
    features: ['Role-Based Access Control (RBAC) with built-in and custom roles', 'Atlas MFA (TOTP, SMS, Okta, etc.)', 'LDAP/Active Directory integration', 'x.509 certificate authentication', 'SCRAM-SHA-256 (default)', 'OIDC / Workforce Identity Federation (AWS IAM, GCP Service Accounts)'],
    description: 'Atlas RBAC supports granular roles at the database, collection, and field level. Combined with LDAP integration, your existing corporate IAM policies apply directly to database access; a single source of truth for access provisioning that directly satisfies Req 7 and 8.',
    docs: 'https://www.mongodb.com/docs/atlas/security-add-mongodb-users/' },
  { reqs: '10', area: 'Audit Logging and SIEM Integration',
    features: ['Atlas Database Audit Logging (authentication, authorization, CRUD operations)', 'Atlas Log Integration to Datadog, Splunk, Sumo Logic, PagerDuty', 'MongoDB Change Streams for real-time data access monitoring', 'Atlas Alerts for anomaly detection'],
    description: 'Atlas audit logging captures every authentication attempt, authorization decision, and data operation with user ID, timestamp, source IP, and outcome. Log Integration forwards these in real time to your SIEM, satisfying the automated daily review requirement (Req 10.4.1.1) without manual intervention.',
    docs: 'https://www.mongodb.com/docs/atlas/database-auditing/' },
  { reqs: '11', area: 'Security Testing and Vulnerability Management',
    features: ['Atlas Security Advisor (configuration recommendations)', 'Automated minor-version patching (Atlas manages underlying infrastructure)', 'MongoDB Security Advisories (CVE notifications)'],
    description: 'For Atlas deployments, MongoDB manages the underlying infrastructure, OS, and database engine patching, removing a significant portion of your patch management burden. The Security Advisor proactively flags misconfigurations such as overly broad IP allowlists and unused database users.',
    docs: 'https://www.mongodb.com/docs/atlas/security-advisor/' },
  { reqs: '12', area: 'Policies, Compliance Evidence and Third-Party Management',
    features: ['Level 1 PCI DSS Service Provider (validated by QSA annually)', 'SOC 2 Type II (bi-annual, available under NDA)', 'ISO 27001:2022 certification (covers 27017 and 27018)', 'Trust and Operational Security Manual (TOSM)', 'Data Processing Agreement (DPA)'],
    description: 'MongoDB Atlas is a PCI DSS Level 1 validated Service Provider, the highest compliance tier. Your PCI assessment can reference MongoDB\'s QSA-validated controls for the infrastructure and database layers, reducing your organization\'s compliance burden.',
    docs: 'https://www.mongodb.com/products/platform/trust/pci-dss' },
];

// goal number → left-border accent color class
const GOAL_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  '1': { border: 'border-l-sky-500',     text: 'text-sky-400',     bg: 'bg-sky-500/10' },
  '2': { border: 'border-l-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  '3': { border: 'border-l-amber-500',   text: 'text-amber-400',   bg: 'bg-amber-500/10' },
  '4': { border: 'border-l-violet-500',  text: 'text-violet-400',  bg: 'bg-violet-500/10' },
  '5': { border: 'border-l-orange-500',  text: 'text-orange-400',  bg: 'bg-orange-500/10' },
  '6': { border: 'border-l-rose-500',    text: 'text-rose-400',    bg: 'bg-rose-500/10' },
};
const GOAL_LABELS: Record<string, string> = {
  '1': 'Secure Network', '2': 'Protect Data', '3': 'Vuln. Mgmt',
  '4': 'Access Control', '5': 'Monitor and Test', '6': 'InfoSec Policy',
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function HelpPage() {
  type Tab = 'overview' | 'checklist' | 'mongodb';
  const [tab, setTab]           = useState<Tab>('checklist');
  const [checked, setChecked]   = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem('pci_dss_checklist');
      if (raw) setChecked(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('pci_dss_checklist', JSON.stringify([...checked])); }
    catch { /* quota */ }
  }, [checked]);

  const toggle = (id: string, set: Set<string>, setter: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n);
  };

  const totalItems     = REQUIREMENTS.reduce((s, r) => s + r.items.length, 0);
  const completedItems = checked.size;
  const progress       = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return (
    <>
      {/* ── Print CSS ─────────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          /* Hide the entire app shell */
          header, aside, nav { display: none !important; }
          /* Make content fill the full page */
          body { background: #fff !important; }
          main, #main-content { padding: 0 !important; }
          /* Content wrapper */
          .help-page-root { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }

          @page { size: A4 portrait; margin: 1.8cm 2cm 2.2cm 2cm; }
          *, *::before, *::after { box-sizing: border-box; }
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #111; line-height: 1.45; }

          /* Screen-only elements hidden in print */
          .screen-only { display: none !important; }
          /* Print-only elements shown */
          .print-only { display: block !important; }
          .print-only-flex { display: flex !important; }

          /* All tab sections visible sequentially */
          .tab-section { display: block !important; }

          /* ── Cover page ── */
          .p-cover { page-break-after: always; padding: 4cm 1cm 3cm; text-align: center; border-bottom: 3px solid #00684A; }
          .p-cover-title { font-size: 28pt; font-weight: 800; color: #00684A; margin: 0 0 .3cm; line-height: 1.1; }
          .p-cover-sub   { font-size: 14pt; color: #333; font-weight: 400; margin: 0 0 .8cm; }
          .p-cover-meta  { font-size: 9pt; color: #666; margin: .2cm 0; }
          .p-cover-badge { display: inline-block; margin-top: .6cm; background: #f0faf5; border: 1.5px solid #00684A; color: #00684A; padding: .25cm .6cm; border-radius: 4px; font-size: 9pt; font-weight: 700; }

          /* ── Section headers ── */
          .p-section-break { page-break-before: always; padding-top: .3cm; }
          .p-section-title { font-size: 18pt; font-weight: 800; color: #00684A; margin: 0 0 .15cm; }
          .p-section-sub   { font-size: 9pt; color: #555; margin: 0 0 .5cm; padding-bottom: .3cm; border-bottom: 1px solid #ddd; }

          /* ── Requirement block ── */
          .p-req-block { margin-bottom: .5cm; }
          .p-req-header { display: flex; align-items: flex-start; gap: .3cm; margin-bottom: .2cm; break-after: avoid; }
          .p-req-num   { font-size: 8pt; font-weight: 800; padding: 3px 8px; border-radius: 4px; background: #f0faf5; border: 1.5px solid #00684A; color: #00684A; white-space: nowrap; flex-shrink: 0; }
          .p-req-title { font-size: 11pt; font-weight: 700; color: #111; }
          .p-req-goal  { font-size: 7.5pt; color: #777; margin-top: 2px; }
          .p-req-summary { font-size: 8.5pt; color: #333; margin: .12cm 0 .15cm; line-height: 1.45; padding-left: 1.1cm; }
          .p-req-freq    { font-size: 7.5pt; color: #888; margin-bottom: .2cm; padding-left: 1.1cm; }

          /* ── Checklist items ── */
          .p-items { padding-left: 1.1cm; }
          .p-item  { display: flex; align-items: flex-start; gap: .2cm; padding: .12cm 0; border-bottom: 1px solid #f0f0f0; break-inside: avoid; }
          .p-item:last-child { border-bottom: none; }
          .p-item-cb   { width: 10px; height: 10px; border: 1.5px solid #aaa; border-radius: 2px; flex-shrink: 0; margin-top: 2px; }
          .p-item-body { flex: 1; }
          .p-item-text { font-size: 8.5pt; color: #111; font-weight: 500; }
          .p-item-det  { font-size: 7.5pt; color: #555; margin-top: 2px; line-height: 1.35; }
          .p-v4-badge  { display: inline-block; font-size: 6.5pt; font-weight: 700; color: #92400e; background: #fffbeb; border: 1px solid #d97706; padding: 1px 5px; border-radius: 3px; margin-left: 5px; vertical-align: middle; }

          /* ── MongoDB features ── */
          .p-mdb-features { display: flex; flex-wrap: wrap; gap: 3px; margin: .15cm 0 .1cm 1.1cm; }
          .p-mdb-tag { font-size: 6.5pt; padding: 2px 7px; border: 1px solid #00684A; color: #00684A; border-radius: 99px; }

          /* ── MongoDB mapping cards ── */
          .p-mdb-card { border: 1px solid #d1e7dd; border-left: 4px solid #00684A; border-radius: 5px; padding: .3cm .4cm; margin-bottom: .3cm; background: #f8fffe; break-inside: avoid; }
          .p-mdb-reqs { font-size: 8pt; font-weight: 700; color: #00684A; margin-bottom: .05cm; }
          .p-mdb-area { font-size: 10.5pt; font-weight: 700; color: #111; margin-bottom: .08cm; }
          .p-mdb-desc { font-size: 8pt; color: #333; line-height: 1.4; margin-bottom: .15cm; }
          .p-mdb-link { font-size: 7.5pt; color: #1d4ed8; }
          .p-mdb-tags-block { display: flex; flex-wrap: wrap; gap: 4px; margin: .12cm 0; }

          /* ── Reference architecture ── */
          .p-arch-layer { border: 1px solid #e0e0e0; border-radius: 4px; padding: .25cm .35cm; margin-bottom: .2cm; break-inside: avoid; }
          .p-arch-title { font-size: 9.5pt; font-weight: 700; color: #111; margin-bottom: .1cm; }
          .p-arch-items { list-style: none; margin: 0; padding: 0; }
          .p-arch-item  { font-size: 8pt; color: #333; padding-left: 1em; position: relative; margin-bottom: 2px; }
          .p-arch-item::before { content: "›"; position: absolute; left: 0; color: #00684A; font-weight: bold; }

          /* ── Value props ── */
          .p-vp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .25cm; }
          .p-vp-card { border: 1px solid #e0e0e0; border-radius: 4px; padding: .25cm .3cm; break-inside: avoid; }
          .p-vp-title { font-size: 9.5pt; font-weight: 700; color: #111; margin-bottom: .08cm; }
          .p-vp-desc  { font-size: 7.5pt; color: #444; line-height: 1.35; }

          /* ── Glossary ── */
          .p-def-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .15cm .6cm; }
          .p-def-row  { display: flex; gap: .2cm; break-inside: avoid; margin-bottom: .08cm; }
          .p-def-term { font-size: 8pt; font-weight: 700; color: #00684A; width: 1.3cm; flex-shrink: 0; }
          .p-def-text { font-size: 7.5pt; color: #444; line-height: 1.35; }

          /* ── Reference links ── */
          .p-ref-link { font-size: 7.5pt; color: #1d4ed8; display: block; margin-bottom: 3px; }

          /* Page numbers, suppress browser default headers/footers, show only page number at bottom-right */
          @page {
            @top-left    { content: ""; }
            @top-center  { content: ""; }
            @top-right   { content: ""; }
            @bottom-left { content: ""; }
            @bottom-center { content: ""; }
            @bottom-right  { content: counter(page); font-size: 8pt; color: #888; font-family: 'Helvetica Neue', Arial, sans-serif; }
          }
          @page:first {
            @bottom-right { content: ""; }
          }
        }

        @media screen {
          .print-only, .print-only-flex { display: none !important; }
        }
      `}</style>

      {/* ─── Printable cover ────────────────────────────────────────────────── */}
      <div className="print-only p-cover">
        <div className="p-cover-title">Compliance Guide</div>
        <div className="p-cover-sub">PCI DSS v4.0.1 Checklist · Architecture Proposal</div>
        <div className="p-cover-meta">Powered by MongoDB Atlas · Built for digital banks and card issuers</div>
        <div className="p-cover-badge">PCI DSS v4.0.1 (June 2024) · All requirements mandatory as of March 31, 2025</div>
        <div className="p-cover-meta" style={{ marginTop: '1cm', fontSize: '7.5pt', color: '#aaa' }}>
          Reference: https://www.pcisecuritystandards.org/document_library/
        </div>
      </div>

      {/* ─── Screen page ────────────────────────────────────────────────────── */}
      <div className="help-page-root w-full px-5 sm:px-8 lg:px-12 py-6 pb-24">

        {/* Header */}
        <div className="screen-only flex items-center justify-between gap-4 mb-7">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#001E2B]/10 border border-[#001E2B]/20 flex items-center justify-center shrink-0">
              <Shield size={17} className="text-[#001E2B]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#001E2B] leading-tight">Compliance Guide</h1>
              <p className="text-gray-500 text-sm mt-0.5">PCI DSS v4.0.1 Checklist · Architecture Proposal</p>
            </div>
          </div>
          <div className="relative group shrink-0">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
            >
              <Download size={14} /> Export PDF
            </button>
            <div className="pointer-events-none absolute right-0 top-full mt-2 hidden group-hover:block z-50 bg-gray-900 border border-gray-700 text-gray-300 text-[11px] rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
              In the print dialog, uncheck &ldquo;Headers and footers&rdquo;
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="screen-only flex border-b border-gray-300 mb-6 gap-1">
          {([
            { id: 'overview',  label: 'Demo Overview',    icon: Eye },
            { id: 'checklist', label: 'PCI DSS v4.0.1 Checklist',     icon: CheckSquare },
            { id: 'mongodb',   label: 'Architecture Proposal', icon: Database },
          ] as { id: Tab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-[15px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === id
                  ? 'border-[#001E2B] text-[#001E2B]'
                  : 'border-transparent text-gray-500 hover:text-[#001E2B]'
              }`}
            >
              <Icon size={15} className={tab === id ? 'text-[#001E2B]' : 'text-gray-400'} /> {label}
            </button>
          ))}
        </div>

        {/* ══ OVERVIEW ══════════════════════════════════════════════════════ */}
        <div className={`tab-section space-y-4 ${tab !== 'overview' ? 'screen-only hidden' : ''}`}>

          {/* Print header */}
          <div className="print-only">
            <div className="p-section-title">Demo Overview</div>
            <div className="p-section-sub">What this FSI/PCI DSS demo shows and how MongoDB solves the core compliance challenge.</div>
          </div>

          {/* About card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <p className="text-[11px] font-semibold text-[#00ED64] uppercase tracking-widest mb-2">About this demo</p>
            <h2 className="text-base font-semibold text-white mb-3">FSI PSP on MongoDB Atlas</h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-3">
              This demo shows how a <span className="text-gray-200 font-medium">digital bank or card issuer</span> can use{' '}
              <span className="text-[#00ED64] font-medium">MongoDB Atlas</span> to run a PCI DSS-aligned payment fraud
              investigation workflow; enabling analysts to search and query encrypted sensitive cardholder data
              without that data ever being exposed to the database server.
            </p>
            <p className="text-gray-400 text-sm leading-relaxed">
              The system demonstrates the full lifecycle of a fraud case, from automated transaction scoring through
              multi-tier analyst investigation to resolution, while keeping sensitive fields encrypted at rest using{' '}
              <span className="text-gray-200 font-medium">MongoDB Queryable Encryption (QE)</span>.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Problem */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                <p className="text-sm font-semibold text-white">The Problem Solved</p>
              </div>
              <ul className="space-y-2.5">
                {[
                  'PCI DSS requires encrypting PAN at rest, but encrypted data is traditionally unsearchable.',
                  'Fraud analysts need to search by card number without decrypting in the application tier.',
                  'Compliance requires full audit trails of who accessed sensitive data and when.',
                  'Multiple analyst roles need different levels of access to sensitive data (RBAC).',
                ].map(t => (
                  <li key={t} className="flex items-start gap-2.5">
                    <span className="text-amber-500 shrink-0 text-sm leading-5">›</span>
                    <span className="text-gray-400 text-sm leading-snug">{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Solution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Lock size={15} className="text-[#00ED64] shrink-0" />
                <p className="text-sm font-semibold text-white">The MongoDB Solution</p>
              </div>
              <ul className="space-y-2.5">
                {[
                  ['Queryable Encryption', 'search encrypted PAN without exposing plaintext to the DB server.'],
                  ['RBAC', 'role-based access so L1 analysts see less than L2 investigators.'],
                  ['Audit Logging', 'every field-level access logged and forwardable to SIEM.'],
                  ['BIAN Data Model', 'industry-standard service domain structure for financial data.'],
                ].map(([k, v]) => (
                  <li key={k} className="flex items-start gap-2.5">
                    <span className="text-[#00ED64] shrink-0 text-sm leading-5">›</span>
                    <span className="text-gray-400 text-sm leading-snug">
                      <span className="text-gray-200 font-medium">{k}.</span> {v}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Personas */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-4">Demo Personas and Roles</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { role: 'L1 Analyst',       desc: 'View fraud cases; search transactions by encrypted card ref.' },
                { role: 'L2 Investigator',  desc: 'Full PAN access; encrypted field decryption; case escalation.' },
                { role: 'Security Auditor', desc: 'Read-only audit log access; compliance reports.' },
                { role: 'Customer',         desc: 'Own transaction history and payment initiation only.' },
                { role: 'Merchant Officer', desc: 'Merchant onboarding review queue and merchant registry.' },
                { role: 'Manager',          desc: 'Integration Hub; external provider management.' },
              ].map(p => (
                <div key={p.role} className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-gray-200 mb-1">{p.role}</p>
                  <p className="text-gray-500 text-xs leading-snug">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* PCI alignment */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={15} className="text-[#00ED64] shrink-0" />
              <p className="text-sm font-semibold text-white">PCI DSS Alignment Demonstrated</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { req: 'Req 3',    title: 'Stored Data Protection', desc: 'PAN encrypted via Queryable Encryption; CVV never stored after auth.' },
                { req: 'Req 7, 8', title: 'Access Control and Auth', desc: 'Role-based access with JWT; each role gets minimum required data access.' },
                { req: 'Req 10',   title: 'Audit Logging',           desc: 'Every case action logged with user, timestamp, and action type.' },
              ].map(a => (
                <div key={a.req} className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3.5">
                  <p className="text-[#00ED64] text-xs font-bold mb-1">{a.req}</p>
                  <p className="text-gray-200 text-xs font-semibold mb-1">{a.title}</p>
                  <p className="text-gray-500 text-xs leading-snug">{a.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ══ PCI CHECKLIST ═════════════════════════════════════════════════ */}
        <div className={`tab-section space-y-3 ${tab !== 'checklist' ? 'screen-only hidden' : ''}`}>

          {/* Print header */}
          <div className="print-only p-section-break">
            <div className="p-section-title">PCI DSS v4.0.1 Compliance Checklist</div>
            <div className="p-section-sub">Standard: PCI DSS v4.0.1 (June 2024). All 51 future-dated requirements became mandatory March 31, 2025. Applies to all entities storing, processing, or transmitting cardholder data (CHD) or sensitive authentication data (SAD).</div>
          </div>

          {/* Progress bar (screen only) */}
          <div className="screen-only bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-white tabular-nums">{progress}%</span>
                <span className="text-gray-500 text-sm">complete</span>
              </div>
              <span className="text-gray-600 text-xs">{completedItems} / {totalItems} items</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden mt-2 mb-3">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progress}%`, background: progress === 100 ? '#00ED64' : progress >= 70 ? '#f59e0b' : '#6b7280' }} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setExpanded(new Set(REQUIREMENTS.map(r => r.num)))}
                className="text-xs text-gray-400 hover:text-white px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors">
                Expand all
              </button>
              <button onClick={() => setExpanded(new Set())}
                className="text-xs text-gray-400 hover:text-white px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors">
                Collapse all
              </button>
              <button onClick={() => setChecked(new Set())}
                className="text-xs text-gray-500 hover:text-rose-400 px-3 py-1.5 bg-gray-800 border border-gray-700 hover:border-rose-800/60 rounded-lg transition-colors ml-auto">
                Reset
              </button>
            </div>
            <p className="text-gray-700 text-[11px] mt-2">
              <span className="text-amber-500 font-bold">★</span> = New in PCI DSS v4.0; mandatory since March 31, 2025
            </p>
          </div>

          {/* Requirements, one unified card, homogeneous background */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {REQUIREMENTS.map((req, reqIdx) => {
            const doneCount  = req.items.filter(i => checked.has(i.id)).length;
            const isExpanded = expanded.has(req.num);
            const gc         = GOAL_COLORS[req.goalNum] ?? GOAL_COLORS['1'];
            const pct        = req.items.length > 0 ? (doneCount / req.items.length) * 100 : 0;
            const allDone    = doneCount === req.items.length && req.items.length > 0;

            return (
              <div key={req.num} className={`${reqIdx > 0 ? 'border-t border-gray-800' : ''} border-l-4 ${gc.border} p-req-block`}>

                {/* Screen toggle header */}
                <button
                  type="button"
                  onClick={() => toggle(req.num, expanded, setExpanded)}
                  className="screen-only w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-800/40 transition-colors"
                >
                  <div className={`shrink-0 w-8 h-8 rounded-lg ${gc.bg} flex items-center justify-center`}>
                    <span className={`text-xs font-black ${gc.text}`}>{req.num}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-200 text-sm font-medium leading-snug">{req.title}</p>
                    <p className={`text-xs mt-0.5 ${gc.text}`}>{GOAL_LABELS[req.goalNum]}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {allDone
                      ? <CheckCircle2 size={16} className="text-[#00ED64]" />
                      : (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-[#00ED64]/40 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-gray-600 text-xs tabular-nums">{doneCount}/{req.items.length}</span>
                        </div>
                      )
                    }
                    {isExpanded
                      ? <ChevronUp size={14} className="text-gray-600" />
                      : <ChevronDown size={14} className="text-gray-600" />
                    }
                  </div>
                </button>

                {/* Print header (always visible in print) */}
                <div className="print-only p-req-header">
                  <span className="p-req-num">REQ {req.num}</span>
                  <div>
                    <div className="p-req-title">{req.title}</div>
                    <div className="p-req-goal">{req.goal}</div>
                  </div>
                </div>

                {/* Screen body, shown when expanded, hidden when collapsed */}
                <div className={isExpanded ? '' : 'hidden'}>

                  {/* Summary */}
                  <div className="border-t border-gray-800 px-5 py-3">
                    <p className="text-gray-400 text-sm leading-relaxed">{req.summary}</p>
                    <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
                      <p className="text-gray-600 text-xs">⏱ {req.frequency}</p>
                      <a href={req.reference} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                        <ExternalLink size={10} /> Official reference
                      </a>
                    </div>
                  </div>

                  {/* Items, rows directly on the card background */}
                  <div className="px-5 pb-1">
                    {req.items.map((item, idx) => {
                      const isDone = checked.has(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggle(item.id, checked, setChecked)}
                          className={`w-full flex items-start gap-3 px-2 py-3 text-left transition-colors rounded ${
                            idx > 0 ? 'border-t border-gray-800/60' : ''
                          } ${isDone ? 'bg-[#00ED64]/[0.03]' : 'hover:bg-gray-800/40'}`}
                        >
                          <div className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                            isDone ? 'bg-[#00ED64] border-[#00ED64]' : 'border-gray-600'
                          }`}>
                            {isDone && <Check size={9} className="text-[#001E2B]" />}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <div className="flex flex-wrap items-start gap-2">
                              <span className={`text-sm leading-snug ${isDone ? 'text-gray-600 line-through decoration-gray-700' : 'text-gray-300'}`}>
                                {item.text}
                              </span>
                              {item.newV4 && (
                                <span className="text-[9px] font-bold text-amber-400 bg-amber-950/80 border border-amber-700/50 px-1.5 py-0.5 rounded shrink-0">★ v4.0</span>
                              )}
                            </div>
                            {item.detail && (
                              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{item.detail}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* MongoDB features */}
                  {req.mongodbFeatures.length > 0 && (
                    <div className="px-5 pb-4 border-t border-gray-800/60 pt-3">
                      <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-widest mb-2">MongoDB Atlas Features</p>
                      <div className="flex flex-wrap gap-1.5">
                        {req.mongodbFeatures.map(f => (
                          <span key={f} className="text-[11px] text-[#00ED64]/70 border border-[#00ED64]/15 bg-[#00ED64]/[0.04] px-2.5 py-0.5 rounded-full">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Print body, always visible in print, hidden on screen via print-only */}
                <div className="print-only">
                  <div className="p-req-summary">{req.summary}</div>
                  <div className="p-req-freq">⏱ {req.frequency}</div>
                  <div className="p-items">
                    {req.items.map((item) => (
                      <div key={`p-${item.id}`} className="p-item">
                        <div className="p-item-cb" />
                        <div className="p-item-body">
                          <span className="p-item-text">{item.text}</span>
                          {item.newV4 && <span className="p-v4-badge">★ v4.0</span>}
                          {item.detail && <div className="p-item-det">{item.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {req.mongodbFeatures.length > 0 && (
                    <div className="p-mdb-features">
                      {req.mongodbFeatures.map(f => (
                        <span key={`pp-${f}`} className="p-mdb-tag">{f}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>

          {/* Glossary */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mt-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-4">Key Definitions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 p-def-grid">
              {[
                ['PAN',  'Primary Account Number; the 13 to 19 digit payment card number.'],
                ['SAD',  'Sensitive Authentication Data; full track data, CVV2/CVC2/CID, and PINs. Must NEVER be stored after authorization.'],
                ['CDE',  'Cardholder Data Environment; the network that stores, processes, or transmits CHD or SAD.'],
                ['CHD',  'Cardholder Data; at minimum the full PAN; may include cardholder name, expiry, and service code.'],
                ['QSA',  'Qualified Security Assessor; individual certified by PCI SSC to produce ROC/AOC.'],
                ['ASV',  'Approved Scanning Vendor; certified to perform external vulnerability scans. Required quarterly.'],
                ['ROC',  'Report on Compliance; the assessment document produced by a QSA for Level 1 entities.'],
                ['SAQ',  'Self-Assessment Questionnaire; validation tool for eligible merchants/SPs. 10 types available.'],
                ['TRA',  'Targeted Risk Analysis; formal risk analysis introduced in v4.0 for periodic activity frequencies.'],
                ['P2PE', 'Point-to-Point Encryption; can reduce merchant scope to SAQ P2PE (approx. 33 requirements).'],
              ].map(([term, def]) => (
                <div key={term} className="flex gap-2.5 p-def-row">
                  <span className="font-bold text-[#00ED64] text-xs shrink-0 w-12 p-def-term">{term}</span>
                  <span className="text-gray-500 text-xs leading-snug p-def-text">{def}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-gray-800">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3">Official References</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                {[
                  ['PCI SSC Document Library',    'https://www.pcisecuritystandards.org/document_library/'],
                  ['PCI DSS v4.0.1 Standard PDF', 'https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI_DSS_v4_0_1.pdf'],
                  ['QSA and ASV Directory',       'https://listings.pcisecuritystandards.org/pci_security/dtr'],
                  ['Approved Scanning Vendors',   'https://www.pcisecuritystandards.org/assessors_and_solutions/approved_scanning_vendors'],
                  ['PCI DSS v4.0 Resource Hub',   'https://blog.pcisecuritystandards.org/pci-dss-v4-0-resource-hub'],
                  ['Customized Approach Guidance','https://blog.pcisecuritystandards.org/pci-dss-v4-0-is-the-customized-approach-right-for-your-organization'],
                ].map(([label, url]) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-blue-400 hover:text-[#00ED64] transition-colors p-ref-link">
                    <ExternalLink size={10} className="shrink-0" />
                    <span className="text-xs">{label}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ══ MONGODB PROPOSAL ══════════════════════════════════════════════ */}
        <div className={`tab-section space-y-4 ${tab !== 'mongodb' ? 'screen-only hidden' : ''}`}>

          {/* Print header */}
          <div className="print-only p-section-break">
            <div className="p-section-title">MongoDB Atlas; PCI DSS Architecture Proposal</div>
            <div className="p-section-sub">How MongoDB Atlas features map to each PCI DSS requirement. Reference architecture for card issuers, digital banks, and payment service providers.</div>
          </div>

          {/* Level 1 badge */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-lg bg-[#00ED64]/10 border border-[#00ED64]/20 flex items-center justify-center shrink-0 mt-0.5">
                <Shield size={20} className="text-[#00ED64]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-[#00ED64] uppercase tracking-widest mb-1">PCI DSS Level 1 Service Provider</p>
                <p className="text-gray-400 text-sm leading-relaxed">
                  MongoDB Atlas is validated as a <span className="text-gray-200 font-medium">Level 1 PCI DSS Service Provider</span>, the highest compliance tier,
                  assessed annually by a Qualified Security Assessor (QSA). Your PCI assessment can reference
                  MongoDB&apos;s QSA-validated controls, reducing your organization&apos;s compliance burden through the shared responsibility model.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {['PCI DSS Level 1 SP', 'SOC 2 Type II', 'ISO 27001:2022', 'ISO 27017', 'ISO 27018', 'CSA STAR'].map(cert => (
                    <span key={cert} className="text-xs text-[#00ED64]/80 border border-[#00ED64]/20 bg-[#00ED64]/5 px-2.5 py-0.5 rounded-full">{cert}</span>
                  ))}
                </div>
                <a href="https://www.mongodb.com/products/platform/trust/pci-dss" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-3 transition-colors">
                  <ExternalLink size={10} /> MongoDB Trust Center
                </a>
              </div>
            </div>
          </div>

          {/* Feature mapping */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3">Feature Mapping by Requirement</p>
            <div className="space-y-3">
              {MONGODB_MAPPING.map((m) => (
                <div key={m.reqs} className="bg-gray-900 border border-gray-800 rounded-xl p-5 p-mdb-card">
                  <div className="flex items-start gap-3 mb-3">
                    <span className="text-xs font-bold text-[#00ED64] bg-[#00ED64]/10 border border-[#00ED64]/20 px-2.5 py-1 rounded-lg shrink-0 p-mdb-reqs">
                      REQ {m.reqs}
                    </span>
                    <div className="min-w-0">
                      <p className="text-gray-200 font-semibold text-sm leading-snug p-mdb-area">{m.area}</p>
                      <p className="text-gray-500 text-xs mt-1 leading-relaxed p-mdb-desc">{m.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3 p-mdb-tags-block">
                    {m.features.map(f => (
                      <span key={f} className="text-xs text-gray-400 border border-gray-700 bg-gray-800/60 px-2.5 py-0.5 rounded-full p-mdb-tag">{f}</span>
                    ))}
                  </div>
                  <a href={m.docs} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors p-mdb-link">
                    <ExternalLink size={10} /> Documentation
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Reference architecture */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-1">Reference Architecture</p>
            <p className="text-gray-600 text-xs mb-4">A 5-layer security model using MongoDB Atlas for a PCI DSS-compliant cardholder data environment.</p>
            <div className="space-y-2">
              {[
                { num: '①', label: 'Application Tier',         color: GOAL_COLORS['2'],
                  items: ['Application-layer encryption; MongoDB driver encrypts PAN before sending to Atlas (CSFLE/QE).', 'No plaintext PAN in application logs or error messages.', 'JWT-based session management with short expiry and MFA enforcement.', 'WAF in front of all public-facing APIs (Req 6.4.2).'] },
                { num: '②', label: 'Network Tier',              color: GOAL_COLORS['1'],
                  items: ['Private Endpoints; all Atlas traffic stays on cloud provider backbone, never public internet.', 'IP Access List; only application server IPs whitelisted in Atlas.', 'VPC/VNet peering for multi-region deployments.', 'TLS 1.2/1.3 enforced on all connections; cannot be downgraded.'] },
                { num: '③', label: 'Data Tier (Atlas)',          color: GOAL_COLORS['3'],
                  items: ['Queryable Encryption; PAN stored and searched in encrypted form. MongoDB server never sees plaintext.', 'Customer-Managed Keys (CMK); your KMS (AWS/Azure/GCP) encrypts the data encryption keys.', 'RBAC; custom roles grant minimum required privileges per user type.', 'SCRAM-SHA-256 or x.509 authentication for all database users.'] },
                { num: '④', label: 'Monitoring and Audit Tier', color: GOAL_COLORS['5'],
                  items: ['Atlas Audit Logging; all authentication, authorization, and CRUD operations logged.', 'Atlas Log Integration to SIEM (Datadog / Splunk / Sumo Logic).', 'Automated alerts for suspicious access patterns and configuration drift.', 'Atlas Security Advisor; continuous compliance posture monitoring.'] },
                { num: '⑤', label: 'Key Management Tier',       color: GOAL_COLORS['4'],
                  items: ['AWS KMS / Azure Key Vault / GCP Cloud KMS / KMIP for master key management.', 'Envelope encryption; data keys encrypted by master keys you control exclusively.', 'Key rotation policy; annual minimum, automated rotation recommended.', 'Split knowledge and dual control for key custodians (Req 3.7).'] },
              ].map(l => (
                <div key={l.label} className={`rounded-lg border border-gray-700/50 bg-gray-800/30 border-l-4 ${l.color.border} p-4 p-arch-layer`}>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`text-sm font-black ${l.color.text}`}>{l.num}</span>
                    <p className={`text-sm font-semibold ${l.color.text} p-arch-title`}>{l.label}</p>
                  </div>
                  <ul className="space-y-1 p-arch-items">
                    {l.items.map(item => (
                      <li key={item} className="text-gray-500 text-xs flex items-start gap-2 p-arch-item">
                        <span className="text-[#00ED64]/60 shrink-0">›</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Value proposition */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-4">MongoDB Value Proposition for PCI DSS</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-vp-grid">
              {[
                { title: 'Queryable Encryption', emoji: '🔐',
                  desc: 'The only commercially available database solution enabling equality searches on client-side encrypted fields. Zero plaintext PAN exposure to the database server; MongoDB staff included.',
                  link: 'https://www.mongodb.com/docs/manual/core/queryable-encryption/', linkText: 'QE Docs' },
                { title: 'Customer-Managed Keys', emoji: '🗝️',
                  desc: 'Full cryptographic key sovereignty. Your KMS encrypts data keys; MongoDB never has access to your master keys. Satisfies Req 3.6 to 3.7 key management obligations.',
                  link: 'https://www.mongodb.com/docs/atlas/security-kms-encryption/', linkText: 'CMK Docs' },
                { title: 'Private Networking', emoji: '🔒',
                  desc: 'Private Endpoints ensure all CDE traffic stays on cloud-provider backbone. Combined with IP allowlisting, creates a verifiable CDE network boundary satisfying Req 1 and 2.',
                  link: 'https://www.mongodb.com/docs/atlas/security-private-endpoint/', linkText: 'Private Endpoint Docs' },
                { title: 'Audit Logging and SIEM', emoji: '📋',
                  desc: 'Field-level audit logging forwarded to SIEM in real time. Automated daily review satisfies the new Req 10.4.1.1 requirement for automated log review mechanisms.',
                  link: 'https://www.mongodb.com/docs/atlas/database-auditing/', linkText: 'Audit Docs' },
                { title: 'RBAC and Identity Federation', emoji: '👥',
                  desc: 'Granular role-based access at database and collection level. LDAP/AD integration, OIDC/SCIM provisioning, and workforce identity federation satisfy Req 7 and 8.',
                  link: 'https://www.mongodb.com/docs/atlas/security-add-mongodb-users/', linkText: 'RBAC Docs' },
                { title: 'PCI Level 1 Validated SP', emoji: '🏆',
                  desc: 'Annual QSA assessment of the entire Atlas infrastructure. Request MongoDB\'s Attestation of Compliance (AOC) to reference in your own PCI assessment; reducing your compliance scope.',
                  link: 'https://www.mongodb.com/products/platform/trust/pci-dss', linkText: 'Trust Center' },
              ].map(v => (
                <div key={v.title} className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4 p-vp-card">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base leading-none">{v.emoji}</span>
                    <p className="text-sm font-semibold text-gray-200 p-vp-title">{v.title}</p>
                  </div>
                  <p className="text-gray-500 text-xs leading-relaxed mb-3 p-vp-desc">{v.desc}</p>
                  <a href={v.link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                    <ExternalLink size={10} /> {v.linkText}
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="text-center pt-2 pb-4 border-t border-gray-800">
            <p className="text-gray-700 text-xs">References PCI DSS v4.0.1 (June 2024). Always consult the official PCI SSC documentation for your compliance assessment.</p>
            <a href="https://www.mongodb.com/products/platform/trust" className="text-blue-500/70 hover:text-blue-400 text-xs mt-1 inline-block transition-colors" target="_blank" rel="noopener noreferrer">
              mongodb.com/products/platform/trust
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
