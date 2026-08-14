# PCI DSS checklist: clause references

The Help section carries a PCI DSS control checklist. Its clause numbers were removed from the UI.
They are PCI SSC numbering, they were renumbered between v3.2.1 and v4.0, and a stale reference
rendered across the app reads as a factual claim while being expensive to correct in every place it
appears. The control statements stayed on screen; only the numbering moved here, where it can be
updated without touching source or risking a regression.

Captured 2026-08-06 from the UI, against PCI DSS v4.0.1. Authoritative text is the standard itself.


## Requirement 1: Install and Maintain Network Security Controls

| Item | Control | Clause reference |
|---|---|---|
| 1.1 | Document and publish a network security control (NSC) policy and assign roles and responsibilities | 1.1.1, 1.1.2 |
| 1.2 | Maintain current network topology diagrams showing all CDE connections and data-flow diagrams | 1.2.3, 1.2.4 |
| 1.3 | Configure all NSCs with deny-all default; allow only explicitly justified services, protocols, and ports | 1.2.1, 1.3.1, 1.3.2 |
| 1.4 | Install NSCs between all wireless networks and the CDE with deny-all default | 1.3.3 |
| 1.5 | Implement anti-spoofing measures to detect and block forged source IP addresses | 1.4.3 |
| 1.6 | Ensure CHD storage systems are not directly accessible from untrusted networks | 1.4.4 |
| 1.7 | Restrict disclosure of internal IP addresses and routing information to external parties | 1.4.5 |
| 1.8 | Review NSC configurations at least every six months and correct identified weaknesses | 1.2.7 |
| 1.9 | Apply security controls to all employee devices connecting to both untrusted networks and the CDE | 1.5.1 |

## Requirement 2: Apply Secure Configurations to All System Components

| Item | Control | Clause reference |
|---|---|---|
| 2.1 | Develop, implement, and maintain configuration standards for all system components | 2.2.1 |
| 2.2 | Change or disable all vendor-supplied default accounts and passwords before installation | 2.2.2 |
| 2.3 | Separate primary functions requiring different security levels onto separate system components | 2.2.3 |
| 2.4 | Enable only necessary functions, components, ports, protocols, and services | 2.2.4 |
| 2.5 | Encrypt all non-console administrative access (SSH, RDP, web-based management) with strong cryptography | 2.2.7 |
| 2.6 | Change all wireless vendor defaults at installation: SSIDs, passwords, SNMP community strings, and encryption keys | 2.3.1, 2.3.2 |

## Requirement 3: Protect Stored Account Data

| Item | Control | Clause reference |
|---|---|---|
| 3.1 | Define and enforce a data retention and disposal policy; store account data only as long as necessary | 3.1.1, 3.2.1 |
| 3.2 | Never store Sensitive Authentication Data (SAD) after authorization is complete | 3.3.1 |
| 3.3 | Render PAN unreadable using AES-256 encryption, truncation, HMAC keyed hashing, or index tokens with separate vault | 3.4.1, 3.5.1.1 |
| 3.4 | Implement technical controls to prevent PAN copy/paste or relocation via remote access tools | 3.4.2 |
| 3.5 | Implement full key management lifecycle: generation, distribution, storage, retirement, replacement, destruction | 3.6.1, 3.7.1 |
| 3.6 | Document your cryptographic architecture: all algorithms, protocols, keys, key strengths, and key custodians | 3.6.1.1 |
| 3.7 | Use only strong cryptography: RSA 2048+, AES-128/256, ECDSA P-256+, and TLS 1.2+; review cipher suite list annually | 3.5.1, 12.3.3 |

## Requirement 4: Protect Cardholder Data with Strong Cryptography During Transmission

| Item | Control | Clause reference |
|---|---|---|
| 4.1 | Use strong cryptography (TLS 1.2+) for all PAN transmissions over open, public networks | 4.2.1 |
| 4.2 | Maintain an inventory of all trusted keys and certificates used to protect PAN in transit | 4.2.1.1 |
| 4.3 | Accept only valid, non-expired, non-revoked certificates from trusted certificate authorities | 4.2.1 |
| 4.4 | Never transmit PANs via unprotected end-user messaging technologies | 4.2.2 |
| 4.5 | Document a cardholder data transmission policy with assigned roles and responsibilities | 4.1.1, 4.1.2 |

## Requirement 5: Protect All Systems and Networks from Malicious Software

| Item | Control | Clause reference |
|---|---|---|
| 5.1 | Deploy anti-malware solutions on all system components; evaluate systems not commonly at risk periodically | 5.2.1, 5.2.3 |
| 5.2 | Ensure anti-malware detects viruses, worms, Trojans, spyware, rootkits, ransomware, and adware | 5.2.2 |
| 5.3 | Enable automatic signature/definition updates and real-time or continuous behavioral scanning | 5.3.1, 5.3.2 |
| 5.4 | Enable and retain anti-malware audit logs per the audit log retention policy (Req 10) | 5.3.4 |
| 5.5 | Prevent users from disabling or altering anti-malware without documented management authorization per-case | 5.3.5 |
| 5.6 | Implement DMARC, SPF, and DKIM to protect personnel from phishing attacks targeting the CDE | 5.4.1 |

## Requirement 6: Develop and Maintain Secure Systems and Software

| Item | Control | Clause reference |
|---|---|---|
| 6.1 | Implement a secure SDLC; train all developers in software security at least annually | 6.2.1, 6.2.2 |
| 6.2 | Review all custom and bespoke software for security vulnerabilities before every production release | 6.2.3, 6.2.3.1 |
| 6.3 | Prevent/mitigate OWASP Top 10 vulnerabilities: injection, XSS, broken auth, IDOR, and CSRF in all custom code | 6.2.4 |
| 6.4 | Apply critical security patches within 1 month of release; apply all other patches within 6 months | 6.3.3 |
| 6.5 | Maintain a software inventory (SBOM-equivalent) for all bespoke and custom software including third-party libraries | 6.3.2 |
| 6.6 | Deploy and maintain a WAF for all public-facing web applications that actively blocks web attacks | 6.4.1, 6.4.2 |
| 6.7 | For payment pages: inventory all scripts, authorize each one, and verify integrity (SRI hashes or CSP) | 6.4.3 |
| 6.8 | Separate development, test, and production environments; prohibit live/production data in test environments | 6.5.1 |

## Requirement 7: Restrict Access to System Components and Cardholder Data by Business Need to Know

| Item | Control | Clause reference |
|---|---|---|
| 7.1 | Implement a least-privilege, need-to-know access control model with deny-all as the default | 7.2.1 |
| 7.2 | Assign access aligned strictly with job classification and function; require formal approval for all access grants | 7.2.2, 7.2.3 |
| 7.3 | Review all user accounts and associated access privileges at least every six months | 7.2.4 |
| 7.4 | Formally manage and periodically review all application and system account access privileges | 7.2.5, 7.2.5.1 |
| 7.5 | Restrict all cardholder data repository queries to programmatic methods only; prohibit direct query tool access | 7.2.6 |
| 7.6 | Deploy an access control system enforcing all access assignments with default set to "deny all" | 7.3.1 |

## Requirement 8: Identify Users and Authenticate Access to System Components

| Item | Control | Clause reference |
|---|---|---|
| 8.1 | Assign a unique ID to every user before granting access to any system component or cardholder data | 8.2.1 |
| 8.2 | Manage the full user ID lifecycle: add, modify, suspend, and delete accounts through a formal identity management process | 8.2.4, 8.2.5 |
| 8.3 | Disable inactive user accounts within 90 days of inactivity | 8.2.6 |
| 8.4 | Lock accounts after a maximum of 10 consecutive failed authentication attempts | 8.3.4 |
| 8.5 | Enforce passwords/passphrases of at least 12 characters containing both numeric and alphabetic characters | 8.3.6 |
| 8.6 | Implement MFA for ALL access into the CDE; every user, every role, every location, every method | 8.4.2 |
| 8.7 | Implement MFA for all remote network access originating from outside the entity\'s network that could impact the CDE | 8.4.3 |
| 8.8 | Ensure MFA implementation is replay-proof and cannot be bypassed by any user including administrators | 8.5.1 |
| 8.9 | Prohibit hard-coded passwords in scripts, configuration files, and source code | 8.6.2 |
| 8.10 | Re-authenticate idle sessions after 15 minutes of inactivity | 8.2.8 |

## Requirement 9: Restrict Physical Access to Cardholder Data

| Item | Control | Clause reference |
|---|---|---|
| 9.1 | Implement appropriate physical entry controls to restrict access to the CDE and sensitive areas | 9.2.1 |
| 9.2 | Monitor sensitive areas with video surveillance or equivalent physical access control mechanisms | 9.2.2 |
| 9.3 | Implement a visitor management process: issue visitor badges, escort visitors, and maintain a visitor log | 9.3.2 |
| 9.4 | Classify all media containing cardholder data by sensitivity level; approve and log all media movements outside the facility | 9.4.2 |
| 9.5 | Destroy all hard-copy materials containing PAN when no longer needed; render electronic media with CHD unrecoverable | 9.4.6, 9.4.7 |
| 9.6 | Maintain an inventory of all POI devices and inspect them periodically for tampering | 9.5.1 |
| 9.7 | Train all POI-handling personnel to identify tampering, unauthorized substitution, and social engineering attempts | 9.5.1.3 |

## Requirement 10: Log and Monitor All Access to System Components and Cardholder Data

| Item | Control | Clause reference |
|---|---|---|
| 10.1 | Enable audit logging on all CDE systems: all user access to CHD, admin actions, invalid login attempts, and access mechanism changes | 10.2.1, 10.2.1.1 |
| 10.2 | Protect audit logs from unauthorized modification and deletion; changes must generate alerts | 10.2.2, 10.3.1 |
| 10.3 | Promptly back up audit logs to a centralized log server or other media that is difficult to alter | 10.3.3 |
| 10.4 | Implement automated mechanisms (SIEM) to review security logs from all CDE systems at least daily | 10.4.1, 10.4.1.1 |
| 10.5 | Retain audit logs for at least 12 months with the most recent 3 months immediately available for analysis | 10.5.1 |
| 10.6 | Synchronize all CDE system clocks from a trusted, industry-accepted time source | 10.6.1 |
| 10.7 | Detect, alert on, and address promptly any failures of critical security controls | 10.7.2, 10.7.3 |

## Requirement 11: Test Security of Systems and Networks Regularly

| Item | Control | Clause reference |
|---|---|---|
| 11.1 | Perform internal vulnerability scans at least every three months using authenticated scanning | 11.3.1, 11.3.1.2 |
| 11.2 | Perform external vulnerability scans via an Approved Scanning Vendor (ASV) at least every three months | 11.3.2 |
| 11.3 | Conduct internal and external penetration testing at least annually and after any significant infrastructure or application changes | 11.4.1, 11.4.2 |
| 11.4 | If using network segmentation to isolate the CDE, test segmentation effectiveness at least annually (service providers: every 6 months) | 11.4.3 |
| 11.5 | Deploy IDS/IPS to detect and/or prevent intrusions into the CDE; update signatures regularly | 11.4.5 |
| 11.6 | Implement file integrity monitoring (FIM) on critical system files; review alerts and perform comparisons at least weekly | 11.5.2 |
| 11.7 | Deploy change-and-tamper detection for payment page HTTP headers and script contents; evaluate at least weekly | 11.6.1 |
| 11.8 | Manage wireless access point detection quarterly; alert on unauthorized APs within 24 hours | 11.2.1 |

## Requirement 12: Support Information Security with Organizational Policies and Programs

| Item | Control | Clause reference |
|---|---|---|
| 12.1 | Publish and maintain an information security policy; review and update it at least annually | 12.1.1, 12.1.2 |
| 12.2 | Formally assign information security responsibility to a CISO or equivalent security-knowledgeable executive | 12.1.4 |
| 12.3 | Conduct a Targeted Risk Analysis (TRA) for each PCI DSS requirement that specifies a "periodic" activity without a defined frequency | 12.3.1 |
| 12.4 | Review cryptographic cipher suites and protocols in use at least annually; plan removal of deprecated algorithms | 12.3.3 |
| 12.5 | Document and confirm the PCI DSS scope at least annually and upon significant change; obtain written executive sign-off | 12.5.2 |
| 12.6 | Conduct a security awareness training program for all personnel upon hire and at least annually; include phishing and social engineering | 12.6.1, 12.6.3 |
| 12.7 | Screen all personnel with CDE access prior to hire; conduct background checks appropriate to their level of access | 12.7.1 |
| 12.8 | Maintain a list of all third-party service providers (TPSPs) with written agreements documenting PCI DSS responsibility allocation | 12.8.1 |
| 12.9 | Maintain and test an incident response plan annually; ensure 24/7 availability of incident response contacts | 12.10.1 |
| 12.10 | Define incident response procedures for PAN found in unexpected locations; include response, notification, and isolation steps | 12.10.7 |
